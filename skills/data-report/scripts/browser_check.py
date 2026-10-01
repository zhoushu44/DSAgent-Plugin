"""通过悟空 daemon 的 browser_use runtime 对生成的 HTML 报告做真渲染校验。

设计：复用 daemon 已起的浏览器，避免外置 Playwright 冷启开销。

公开入口：`run_browser_check(html_path, timeout=15) -> RuntimeCheckResult | None`
- 返回 None 表示 daemon/wukong-cli 不可用，调用方应降级为静态校验
- 返回 dict 表示已完成真渲染校验，包含 ok/issues/page_errors/console_errors/echarts

健壮性保障：
- daemon 探活（无 wukong-cli 或 daemon 未启 → 返回 None）
- SIGINT/SIGTERM 兜底：atexit 清理临时 http server + 残留 tab
- 启动前扫已有 data-report-check tab，统一关掉
- 单次 call 20s timeout，整体硬上限 timeout 秒
- HTTP server 绑 127.0.0.1，临时端口

TODO(wukong-file-protocol): 当 daemon 支持 file:// 协议后（追踪 RewindDesktop
browser_use/http/arguments.rs `embedded browser runtime only supports http:// and
https://` 这条限制何时解除），删除本地 http.server 启动逻辑，改成直接传 file://
URL。当前每个 batch 启停 http server 增加 ~1s 开销 + 端口占用 + 子进程清理负担。
改造点：
  1. 移除 `start_local_server` / `stop_local_server`
  2. URL 由 `file://` + urllib.parse.quote(absolute_path) 拼接
  3. 中文/特殊字符仍需 quote
"""

from __future__ import annotations

import atexit
import http.server
import json
import os
import re
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

# Windows 兼容：默认 stdout 编码是 cp936（GBK），中文 JSON 输出会乱码。
# 显式重设为 utf-8 + errors='replace' 保证跨平台一致输出。
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (ValueError, AttributeError):
        pass  # 非 TTY 或已重定向时可能失败，不影响功能


def _run_no_pipe(
    cmd: list[str], timeout: float | None = None, text: bool = True,
    cwd: str | None = None, env: dict | None = None,
) -> subprocess.CompletedProcess:
    """受限沙箱（DSH workspace-write）禁止创建匿名管道，
    因此不能用 capture_output=True；改为临时文件承接子进程 stdout/stderr，语义等价。"""
    if text:
        out_f = tempfile.NamedTemporaryFile(mode="w", suffix=".out", delete=False, encoding="utf-8", errors="replace", newline="")
        err_f = tempfile.NamedTemporaryFile(mode="w", suffix=".err", delete=False, encoding="utf-8", errors="replace", newline="")
    else:
        out_f = tempfile.NamedTemporaryFile(mode="wb", suffix=".out", delete=False)
        err_f = tempfile.NamedTemporaryFile(mode="wb", suffix=".err", delete=False)
    paths = (out_f.name, err_f.name)
    try:
        try:
            proc = subprocess.run(cmd, stdout=out_f, stderr=err_f, timeout=timeout, cwd=cwd, env=env)
        finally:
            out_f.close()
            err_f.close()
        if text:
            with open(paths[0], encoding="utf-8", errors="replace") as f:
                out = f.read()
            with open(paths[1], encoding="utf-8", errors="replace") as f:
                err = f.read()
        else:
            with open(paths[0], "rb") as f:
                out = f.read()
            with open(paths[1], "rb") as f:
                err = f.read()
        return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
    finally:
        for p in paths:
            try:
                os.unlink(p)
            except OSError:
                pass


# ── 配置 ───────────────────────────────────────────────────────────────

def _wukong_cli_candidates() -> list[str]:
    """SKILL 子进程内查找 wukong-cli 的优先级。

    daemon 在 spawn SKILL 时（参考 RewindDesktop base/environment/wukong_cli.rs）会注入：
      - WUKONG_BIN: 二进制完整路径（最权威）
      - PATH: 包含 wukong-cli 所在目录

    所以正常调用 SKILL 时一定能找到，无需 fallback 到任何写死路径。
    保留 WUKONG_CLI 作为开发者本地 escape hatch（指向 dev build）。
    """
    return [
        os.environ.get("WUKONG_BIN", ""),   # daemon 官方注入（生产首选）
        os.environ.get("WUKONG_CLI", ""),   # 开发者本地覆盖
        shutil.which("wukong-cli") or "",   # PATH lookup（daemon 也注入了）
    ]
# 超时配置（跨平台：subprocess.run 的 timeout 在 mac/linux/windows 都支持）
_PROBE_TIMEOUT_SEC = 3           # daemon 探活：失败立刻降级，不留长尾
_CALL_TIMEOUT_SEC = 15           # 单次 wukong-cli call 上限
_WAIT_FOR_NETWORKIDLE_MS = 5000  # daemon 内部 wait_for 上限
_LAYOUT_SETTLE_SEC = 0.8         # WebKit 渲染稳定 + pageerror flush（原 0.4s 偶发漏抓）
_TRIGGER_SETTLE_SEC = 0.6        # resize/hover 触发后等异步 error handler flush
_PAGEERROR_RETRY_DELAY_SEC = 0.5 # page_errors 为空时的二次抓取间隔
_DEFAULT_TOTAL_TIMEOUT = 30      # 整体硬截止默认值（包含 server 启停 + 5 次 call）
_SERVER_PROBE_RETRIES = 20       # http server 启动探活：200ms × N
_SERVER_PROBE_INTERVAL = 0.1
_CLEANUP_TIMEOUT_SEC = 5         # cleanup 阶段子命令上限

# 全局清理表（atexit / signal / 多线程共享 — 用 _state_lock 保护读写）
# Agent 并发多个任务可能同时调 run_browser_check，必须线程安全。
_state_lock = threading.Lock()
_ACTIVE_SERVERS: list[subprocess.Popen] = []      # tempfile 模式: python -m http.server 子进程
_ACTIVE_MEM_SERVERS: list[Any] = []               # memory 模式: ThreadingHTTPServer 实例
_ACTIVE_TABS: list[str] = []
_CLEANUP_HOOKED = False


# ── localize cross-origin scripts ─────────────────────────────────────
#
# 背景:WKWebView 对跨域 <script> 抛错强制脱敏成 "Script error.",
# message/source/stack 全清空 (W3C 'muted errors' 规范)。
# crossorigin="anonymous" 在 WKWebView 下实测无效 (跟 Chromium 不同)。
# 唯一解法 = 让 script 与主页面同源。
#
# 实现:HTML 加载前正则扫所有跨域 <script src>,下载内容到内存 store,
# 改写为相对路径。daemon 加载 patched HTML 时, script 由本进程内的
# ThreadingHTTPServer 提供 — 跟主页面同 origin (127.0.0.1:<port>),不脱敏。

_SCRIPT_TAG_RE = re.compile(
    r'<script\b([^>]*?)\bsrc=(["\'])((?:https?:)?//[^"\']+)\2([^>]*)>',
    re.IGNORECASE | re.DOTALL,
)
_PRELOAD_TAG_RE = re.compile(
    r'<link\b([^>]*?)\bhref=(["\'])((?:https?:)?//[^"\']+)\2([^>]*?)>',
    re.IGNORECASE | re.DOTALL,
)
# integrity 属性 — patched 后 SRI hash 不匹配, 浏览器会拒载, 必须移除
_INTEGRITY_ATTR_RE = re.compile(r'\s*\bintegrity=(["\']).*?\1', re.IGNORECASE)
# HTML 注释 — 内部 <script src> 浏览器不请求, 不应误下载
_HTML_COMMENT_RE = re.compile(r'<!--.*?-->', re.DOTALL)

_LOCALIZE_DEFAULT_MAX_PER_FILE = 5 * 1024 * 1024     # 5 MB
_LOCALIZE_DEFAULT_MAX_TOTAL = 20 * 1024 * 1024       # 20 MB
# Windows 上实测 CDN 偶发卡 20s+, 吃光顶层 timeout (case 全部超时).
# 10s 失败更快 fallback 到原 CDN 加载, daemon 仍能跑完。
_LOCALIZE_DEFAULT_FETCH_TIMEOUT = 10                  # 秒

# CDN 选择白名单 — 跟 references/chart-reference.md 一致
# 推荐 (国内稳定):
_CDN_RECOMMENDED = ("cdn.bootcdn.net", "lib.baomitu.com",
                    "echarts.apache.org", "registry.npmmirror.com")
# 慎用 (中国大陆网络偶发不可用):
_CDN_RISKY = {
    "cdn.jsdelivr.net":  "国内时段性不可用 (CloudFlare 节点限制), 用户高概率白屏",
    "unpkg.com":          "国内时段性不可用, 同 jsdelivr",
    "cdnjs.cloudflare.com": "Cloudflare 节点国内偶发不稳",
    "fastly.jsdelivr.net": "jsdelivr 替代节点, 同上风险",
}
_CDN_RISKY_HOSTS_RE = re.compile(
    "|".join(re.escape(h) for h in _CDN_RISKY),
    re.IGNORECASE,
)
_ECHARTS_SCRIPT_RE = re.compile(
    r'<script\b[^>]*?\bsrc=["\']([^"\']*echarts[^"\']*)["\']',
    re.IGNORECASE,
)

# Early error listener — 注入到 patched HTML 的 <head> 最顶部
# 在所有其他 <script> / ECharts 加载之前注册 window.error / unhandledrejection,
# 把错存到 window.__rewindEarlyErrors。
#
# 为什么需要:
# daemon 的 installObserveHooks 是 lazy 注入 (第一次 observe action 时才装),
# Windows WebView2 上实测 hook 装上之前发生的错全部丢失。
# 这段 listener 是 SKILL 自己的 buffer, 不依赖 daemon, 第一时间就在 page 上注册,
# capture phase = true 保证不被后续业务代码 stopPropagation 截掉。
# 双保险: addEventListener + onerror + unhandledrejection + onunhandledrejection
# 实测 Chromium WebView2 上 setTimeout/Promise callback 内 uncaught throw
# 不进 addEventListener('error'), 必须挂 window.onerror 才能接到。
_EARLY_LISTENER_SNIPPET = (
    "<script>"
    "(function(){"
    "var errs=window.__rewindEarlyErrors=window.__rewindEarlyErrors||[];"
    "function push(msg,file,ln,col,stk,via){"
    "errs.push({message:msg||'unknown',filename:file||'',lineno:ln||0,colno:col||0,"
    "stack:stk||'',via:via,ts:Date.now()});"
    "}"
    # addEventListener 路径 — W3C 标准, capture phase 防被截
    "window.addEventListener('error',function(e){"
    "push(e.message||(e.error&&e.error.message),e.filename,e.lineno,e.colno,"
    "e.error&&e.error.stack,'addEventListener');"
    "},true);"
    # window.onerror 路径 — 传统, Chromium setTimeout 错只走这条
    "var _pre=window.onerror;"
    "window.onerror=function(msg,src,ln,col,err){"
    "push(msg,src,ln,col,err&&err.stack,'onerror');"
    "if(typeof _pre==='function'){try{return _pre.apply(this,arguments);}catch(e){}}"
    "return false;"
    "};"
    # unhandledrejection 路径
    "window.addEventListener('unhandledrejection',function(e){"
    "var r=e.reason;"
    "push('Unhandled rejection: '+((r&&r.message)||String(r)),"
    "'unhandledrejection',0,0,r&&r.stack,'addEventListener');"
    "},true);"
    "var _preR=window.onunhandledrejection;"
    "window.onunhandledrejection=function(e){"
    "var r=e.reason;"
    "push('Unhandled rejection: '+((r&&r.message)||String(r)),"
    "'onunhandledrejection',0,0,r&&r.stack,'onunhandledrejection');"
    "if(typeof _preR==='function'){try{return _preR.apply(this,arguments);}catch(e){}}"
    "};"
    "})();"
    "</script>"
)
# 匹配 <head ...> 开标签
_HEAD_OPEN_TAG_RE = re.compile(r'<head\b[^>]*>', re.IGNORECASE)
_HTML_OPEN_TAG_RE = re.compile(r'<html\b[^>]*>', re.IGNORECASE)


# ── 诊断 JS（在页面上跑，返回 ECharts/容器/库 状态）──────────────────

TRIGGER_FN = r"""
() => {
  // 主动触发常见"懒触发"错误路径：
  // 1) window.resize → ECharts chart.resize() 内部错（如 case_030 'c.resize is not a function'）
  // 2) chart 中心 mouseover/mousemove → tooltip formatter / getAttribute 错
  //    （如 case_005 trial-002 'getAttribute of null'，case_026 'toFixed' tooltip）
  // 注意：仅触发可见 chart，避免 0x0 容器抛额外错（display:none tab 内 chart 跳过）。
  try { window.dispatchEvent(new Event('resize')); } catch(e) {}
  if (typeof echarts === 'undefined') return { triggered: 0 };
  let triggered = 0;
  document.querySelectorAll('*').forEach(el => {
    let inst = null;
    try { inst = echarts.getInstanceByDom(el); } catch(e) {}
    if (!inst) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return; // 跳过隐藏 / 未挂载的 chart
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    ['mouseover', 'mousemove'].forEach(t => {
      try {
        el.dispatchEvent(new MouseEvent(t, { clientX: cx, clientY: cy, bubbles: true }));
      } catch (e) {}
    });
    triggered++;
  });
  return { triggered };
}
"""

DIAG_FN = r"""
() => {
  const out = {
    hasEcharts: typeof echarts !== 'undefined',
    echartsCount: 0, instances: [],
    chartLikeContainers: 0, chartLibLoaded: false,
    canvasCount: 0, staticImgCount: 0,
  };
  out.chartLikeContainers = document.querySelectorAll(
    '[id*="chart" i], [class*="chart" i], [id*="figure" i], [class*="figure" i]'
  ).length;
  out.canvasCount = document.querySelectorAll('canvas').length;
  out.staticImgCount = Array.from(document.querySelectorAll('img[src]'))
    .filter(i => !/^data:/.test(i.getAttribute('src') || '')).length;
  const scripts = Array.from(document.scripts).map(s => s.src || '');
  out.chartLibLoaded = scripts.some(s => /echarts|chart\.js|chartjs|d3\.|plotly|highcharts/i.test(s))
    || typeof echarts !== 'undefined' || typeof Chart !== 'undefined'
    || typeof d3 !== 'undefined' || typeof Plotly !== 'undefined';
  if (!out.hasEcharts) return out;
  // 判定 chart 是否处于 display:none 祖先内（合法的 tab/折叠 UI）
  const isInHiddenAncestor = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const st = window.getComputedStyle(n);
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return true;
    }
    return false;
  };
  // 递归数 numeric — 处理 radar (value 是 array) / treemap-sunburst (children) 等
  // 结构化 data 形态。修复 FP: 之前只看 v.value 是 number, 把 radar/treemap
  // 误判为"无有效数值"。深度上限 10 防意外大数据循环。
  const countNumeric = (arr, depth) => {
    let n = 0, nz = 0;
    if (!Array.isArray(arr) || depth > 10) return { n, nz };
    for (const v of arr) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'number') {
        if (isFinite(v)) { n++; if (v !== 0) nz++; }
      } else if (Array.isArray(v)) {
        // radar value=[a,b,c,d] / scatter [x,y] 等 — 全数
        for (const x of v) if (typeof x === 'number' && isFinite(x)) { n++; if (x !== 0) nz++; }
      } else if (typeof v === 'object') {
        if (typeof v.value === 'number' && isFinite(v.value)) {
          n++; if (v.value !== 0) nz++;
        } else if (Array.isArray(v.value)) {
          for (const x of v.value) if (typeof x === 'number' && isFinite(x)) { n++; if (x !== 0) nz++; }
        }
        // treemap/sunburst children 递归
        if (Array.isArray(v.children)) {
          const sub = countNumeric(v.children, depth + 1);
          n += sub.n; nz += sub.nz;
        }
      }
    }
    return { n, nz };
  };
  document.querySelectorAll('*').forEach(el => {
    let inst = null;
    try { inst = echarts.getInstanceByDom(el); } catch(e) {}
    if (!inst) return;
    let opt = {};
    try { opt = inst.getOption() || {}; } catch(e) {}
    const series = (opt.series || []).map(s => {
      const arr = Array.isArray(s.data) ? s.data : null;
      // 统计"有效数值"个数：避免 series.data 长度有但全是 null/NaN/0 导致白图
      // 数据格式可能是：数字 / null / [x,y] / {value: N} / {value: [a,b,c]} (radar)
      //                / {value, children:[...]} (treemap, sunburst) 等
      // 递归处理嵌套结构, 防 FP 误判 treemap/radar/sunburst 为"无有效数值"。
      const counts = arr ? countNumeric(arr, 0) : { n: 0, nz: 0 };
      return {
        type: s.type,
        dataLen: arr ? arr.length : (s.data == null ? -1 : -2),
        numericCount: counts.n,   // 实际有效数字个数 (含递归)
        nonZeroCount: counts.nz,  // 非 0 数字个数
      };
    });
    const xAxis = (opt.xAxis || []).map(a => ({
      dataLen: Array.isArray(a.data) ? a.data.length : (a.data == null ? -1 : -2)
    }));
    const r = el.getBoundingClientRect();
    out.instances.push({
      id: el.id || null,
      width: Math.round(r.width),
      height: Math.round(r.height),
      hiddenByAncestor: isInHiddenAncestor(el),
      series, xAxis
    });
  });
  out.echartsCount = out.instances.length;
  // 反向扫: 找带 id 的 chart/figure 容器, 看是否被 echarts init
  // 4 重启发式过滤防误报: 已 init / 内部有 canvas|svg / 内部有实质内容 / 容器过小
  out.orphanChartDivs = [];
  document.querySelectorAll('div[id*="chart" i], div[id*="figure" i]').forEach(el => {
    let inst = null;
    try { inst = echarts.getInstanceByDom(el); } catch(e) {}
    if (inst) return;
    if (el.querySelector('canvas, svg')) return;
    if ((el.textContent || '').trim().length > 20) return;
    if (el.querySelector('img[src]:not([src^="data:"])')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 50) return;
    out.orphanChartDivs.push({ id: el.id, width: Math.round(r.width), height: Math.round(r.height) });
  });
  return out;
}
"""


# ── daemon / CLI 探活 ──────────────────────────────────────────────────

# 全局 locate 诊断记录,html_report 降级时回传给模型作为 reason
# 不直接落盘以保持简单。html_report.runtime_result.reason 会引用这里。
_LOCATE_DIAG: list[dict] = []


def _locate_wukong_cli() -> Optional[str]:
    """查找 wukong-cli 路径,**任何异常都静默降级**,记录到 _LOCATE_DIAG 供调用方追溯。

    可能失败的场景（实测真实命中）:
      - PermissionError / WinError 5: Windows 安装在另一个用户目录 / UAC 隔离 (实测 2 user)
      - OSError: 网络驱动器掉线 / 路径过长 (Windows MAX_PATH)
      - UnicodeError: 路径含特殊字符
      - shutil.which 异常: 极少见但保险

    设计原则:
      - 任意 candidate 失败 → 试下一个,不让单点异常拖死整条降级链
      - 所有异常都记录到 _LOCATE_DIAG (含 candidate + 异常类型 + 消息)
      - 调用方可读 get_locate_diag() 拿到详细原因传到 transcript
    """
    _LOCATE_DIAG.clear()
    for c in _wukong_cli_candidates():
        if not c:
            continue
        c = c.strip()  # 防环境变量值有前后空白
        if not c:
            continue
        try:
            p = Path(c)
            is_file = p.is_file()
            if not is_file:
                _LOCATE_DIAG.append({"candidate": c, "status": "not_a_file"})
                continue
            executable = os.access(c, os.X_OK)
            if not executable:
                _LOCATE_DIAG.append({"candidate": c, "status": "not_executable"})
                continue
            _LOCATE_DIAG.append({"candidate": c, "status": "ok"})
            return c
        except PermissionError as e:
            # Windows: WinError 5 拒绝访问;Unix: EACCES
            _LOCATE_DIAG.append({
                "candidate": c, "status": "permission_denied",
                "error_type": "PermissionError",
                "error": str(e)[:200],
            })
        except (OSError, ValueError, UnicodeError) as e:
            # OSError: 网络驱动器掉线 / 路径过长
            # ValueError/UnicodeError: 路径含特殊字符或编码问题
            _LOCATE_DIAG.append({
                "candidate": c, "status": "os_error",
                "error_type": type(e).__name__,
                "error": str(e)[:200],
            })
        except Exception as e:  # noqa: BLE001 - 兜底,绝不让异常逃出
            _LOCATE_DIAG.append({
                "candidate": c, "status": "unexpected_error",
                "error_type": type(e).__name__,
                "error": str(e)[:200],
            })
    return None


def get_locate_diag() -> list[dict]:
    """供调用方读取 locate_wukong_cli 的诊断细节。"""
    return list(_LOCATE_DIAG)


def _probe_daemon(cli: str, timeout: float = _PROBE_TIMEOUT_SEC) -> bool:
    """快速判定 daemon 是否可用（不主动启动，避免拖慢调用方）。"""
    try:
        # Windows: 显式 utf-8，否则 text=True 默认 cp936 会乱码
        proc = _run_no_pipe(
            [cli, "service", "status"],
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False
    # wukong-cli service status 返回 "daemon is running" 或 "daemon is not running"
    return "is running" in proc.stdout and "not running" not in proc.stdout


# ── wukong-cli 调用 ────────────────────────────────────────────────────

def _call(cli: str, action: str, deadline: Optional[float] = None, **kwargs) -> dict[str, Any]:
    """调 wukong-cli browser_use call。

    deadline: 全局硬截止（time.time() 时间戳），用于防卡死 — 单次 call 超时取
    min(剩余截止时间, _CALL_TIMEOUT_SEC)，确保流程不会因为某个 call hang 住而被整体拖死。
    """
    if deadline is not None:
        remaining = deadline - time.time()
        if remaining <= 0:
            return {"_error": "deadline exceeded before call", "_action": action}
        call_timeout = min(remaining, _CALL_TIMEOUT_SEC)
    else:
        call_timeout = _CALL_TIMEOUT_SEC

    args = {"action": action, **kwargs}
    try:
        # Windows: encoding='utf-8' 显式指定 — wukong-cli 输出 JSON 含中文（如 page_errors
        # 里的中文文件名）时，text=True 默认按系统 locale（cp936）解码会乱码导致 json.loads 失败
        proc = _run_no_pipe(
            [cli, "browser_use", "call", "--json", json.dumps(args)],
            timeout=call_timeout,
        )
    except subprocess.TimeoutExpired:
        return {"_error": f"timeout(>{call_timeout:.1f}s)", "_action": action}
    except (FileNotFoundError, OSError) as e:
        return {"_error": f"cli launch failed: {e}", "_action": action}
    if proc.returncode != 0:
        return {"_error": proc.stderr[:300], "_rc": proc.returncode, "_action": action}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        idx = proc.stdout.find("{")
        if idx >= 0:
            try: return json.loads(proc.stdout[idx:])
            except json.JSONDecodeError: pass
        return {"_error": "non-json output", "_raw": proc.stdout[:200], "_action": action}


# ── HTTP server (file:// workaround) ───────────────────────────────────

def _find_free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _start_local_server(root: Path) -> tuple[subprocess.Popen, int]:
    port = _find_free_port()
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=str(root),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    with _state_lock:
        _ACTIVE_SERVERS.append(srv)
    # 等端口起来
    for _ in range(_SERVER_PROBE_RETRIES):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.3).close()
            return srv, port
        except OSError:
            time.sleep(_SERVER_PROBE_INTERVAL)
    # 启动失败兜底
    _stop_local_server(srv)
    raise RuntimeError(f"http server on :{port} failed to start")


class _MemoryHandler(http.server.BaseHTTPRequestHandler):
    """从绑定的 server.store dict 取内容, 无磁盘 I/O。"""

    def do_GET(self):  # noqa: N802 — http.server 协议要求
        store = getattr(self.server, "store", None) or {}
        # 同时尝试原 path 和 URL decoded path — 中文文件名 store key 是原中文字符,
        # 浏览器请求 URL encoded (%E8%90%A5...), 不 decode 找不到 → 404
        # 实测: 营销归因分析报告.html 这类 case
        rec = store.get(self.path)
        if rec is None:
            try:
                decoded = urllib.parse.unquote(self.path)
                rec = store.get(decoded)
            except Exception:
                pass
        if rec is None:
            self.send_error(404, f"not in store: {self.path}")
            return
        body, ctype = rec
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_a):  # 静默, 不污染 transcript
        pass


class _ThreadingMemoryServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """多线程 — daemon navigate 时并发请求 HTML + 多个 script。"""
    daemon_threads = True
    allow_reuse_address = True


def _start_memory_server(
    store: dict[str, tuple[bytes, str]],
) -> tuple[_ThreadingMemoryServer, int]:
    port = _find_free_port()
    srv = _ThreadingMemoryServer(("127.0.0.1", port), _MemoryHandler)
    srv.store = store  # type: ignore[attr-defined]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with _state_lock:
        _ACTIVE_MEM_SERVERS.append(srv)
    return srv, port


def _stop_memory_server(srv: _ThreadingMemoryServer) -> None:
    try:
        srv.shutdown()
    except Exception:
        pass
    try:
        srv.server_close()
    except Exception:
        pass
    with _state_lock:
        if srv in _ACTIVE_MEM_SERVERS:
            _ACTIVE_MEM_SERVERS.remove(srv)


def _fetch_to_memory(
    url: str,
    store: dict[str, tuple[bytes, str]],
    failures: list[dict],
    max_per_file: int,
    max_total: int,
    timeout_sec: int,
    allow_domains: Optional[set[str]],
    block_domains: Optional[set[str]],
    deadline: Optional[float] = None,
    slow_loads: Optional[list[dict]] = None,
) -> Optional[str]:
    """下载 url 到 store, 返回本地 path 或 None (失败/被过滤)。

    URL path 用 CDN 的 host/path 结构 (不引入 hash), 错信息里 source 一眼可识。
    """
    abs_url = url if "://" in url else f"https:{url}"  # 协议相对 → 默认 https
    try:
        parsed = urllib.parse.urlparse(abs_url)
    except Exception as e:
        failures.append({"url": url, "reason": f"URL 解析失败: {e}"})
        return None
    host = parsed.netloc

    if block_domains and host in block_domains:
        return None
    if allow_domains is not None and host not in allow_domains:
        return None

    local_path = f"/{host}{parsed.path}"
    if local_path in store:
        return local_path

    used = sum(len(b) for b, _ in store.values())
    if used >= max_total:
        failures.append({"url": url,
                         "reason": f"已超总内存上限 {max_total // 1024 // 1024} MB"})
        return None

    # 单 URL 硬截止 = 启动起 timeout_sec 秒 (默认 10s)
    # 跟外层 wall deadline 取最严格的, 防止单文件慢拖死整体
    # (实测 Windows 无 VPN 时 cdn.plot.ly 持续下载几分钟, urlopen.timeout 不触发)
    t_start = time.time()
    per_url_deadline = t_start + timeout_sec
    effective_deadline = (min(per_url_deadline, deadline)
                          if deadline is not None else per_url_deadline)

    try:
        req = urllib.request.Request(
            abs_url,
            headers={"User-Agent": "Mozilla/5.0 wukong-browser-check"},
        )
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            # Chunked read: 每 64KB 检查 deadline, 数据流持续到来也能强制中断
            ctype = (resp.headers.get("Content-Type")
                     or "application/javascript; charset=utf-8")
            chunks: list[bytes] = []
            total = 0
            limit = max_per_file + 1
            CHUNK = 64 * 1024
            while total < limit:
                if time.time() > effective_deadline:
                    elapsed_now = time.time() - t_start
                    failures.append({
                        "url": url,
                        "reason": (f"下载超时, 已耗 {elapsed_now:.1f}s "
                                   f"已读 {total // 1024} KB — CDN 在当前网络下不稳"),
                        "slow": True,
                        "elapsed_s": round(elapsed_now, 2),
                    })
                    return None
                chunk = resp.read(min(CHUNK, limit - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
            if total > max_per_file:
                failures.append({"url": url,
                                 "reason": f"文件 > {max_per_file // 1024 // 1024} MB 上限"})
                return None
            body = b"".join(chunks)
        elapsed = time.time() - t_start
        store[local_path] = (body, ctype)
        # 下载成功但慢: elapsed > timeout/2 算 slow 信号 (cdn.jsdelivr.net 等海外
        # CDN 在国内偶发"能下完但很慢", 用户体验差, 给模型换 CDN 建议)
        if slow_loads is not None and elapsed > timeout_sec / 2:
            slow_loads.append({
                "url": url,
                "reason": (f"下载完成但耗时 {elapsed:.1f}s (阈值 {timeout_sec / 2:.0f}s) "
                           f"— CDN 在当前网络下不稳, 建议换"),
                "elapsed_s": round(elapsed, 2),
            })
        return local_path
    except urllib.error.HTTPError as e:
        failures.append({"url": url, "reason": f"HTTP {e.code} {e.reason}"})
    except urllib.error.URLError as e:
        failures.append({"url": url, "reason": f"网络错: {e.reason}"})
    except socket.timeout:
        failures.append({"url": url, "reason": f"下载超时 (>{timeout_sec}s)"})
    except Exception as e:
        failures.append({"url": url, "reason": f"{type(e).__name__}: {e}"})
    return None


def _localize_in_memory(
    html: str,
    store: dict[str, tuple[bytes, str]],
    failures: list[dict],
    *,
    include_preload: bool = True,
    allow_domains: Optional[set[str]] = None,
    block_domains: Optional[set[str]] = None,
    max_per_file: int = _LOCALIZE_DEFAULT_MAX_PER_FILE,
    max_total: int = _LOCALIZE_DEFAULT_MAX_TOTAL,
    fetch_timeout: int = _LOCALIZE_DEFAULT_FETCH_TIMEOUT,
    wall_cap_seconds: Optional[float] = None,
    slow_loads: Optional[list[dict]] = None,
) -> tuple[str, int]:
    """改写 HTML 跨域 <script src> + <link rel=preload as=script> 为同源路径。

    返回 (patched_html, 改写计数)。失败的保留原 src + 进 failures 列表。
    """
    # stash 注释, 避免 regex 误匹配注释里的 <script src>
    parked: list[str] = []

    def park(m):
        parked.append(m.group(0))
        return f"<!--__BC_STASH_{len(parked) - 1}__-->"

    html = _HTML_COMMENT_RE.sub(park, html)

    patched = 0
    t_start = time.time()

    def _wall_exceeded():
        if wall_cap_seconds is None:
            return False
        return (time.time() - t_start) > wall_cap_seconds

    def rewrite_script(m):
        nonlocal patched
        # Wall cap: 防 N 个 CDN 串行下载累积吃光顶层 timeout (case_050_plotly Plotly 4MB)
        if _wall_exceeded():
            failures.append({"url": m.group(3),
                             "reason": f"localize wall cap {wall_cap_seconds}s 已达, 跳过"})
            return m.group(0)
        local = _fetch_to_memory(
            m.group(3), store, failures, max_per_file, max_total,
            fetch_timeout, allow_domains, block_domains,
            deadline=(t_start + wall_cap_seconds) if wall_cap_seconds else None,
            slow_loads=slow_loads,
        )
        if local is None:
            return m.group(0)
        patched += 1
        post = _INTEGRITY_ATTR_RE.sub("", m.group(4))
        return f'<script{m.group(1)} src="{local}"{post}>'

    def rewrite_preload(m):
        nonlocal patched
        if _wall_exceeded():
            failures.append({"url": m.group(3),
                             "reason": f"localize wall cap {wall_cap_seconds}s 已达, 跳过"})
            return m.group(0)
        # 只处理 as="script" / "style" 的 preload
        attrs = m.group(1) + m.group(4)
        if not re.search(r'\bas=["\'](?:script|style)["\']', attrs, re.IGNORECASE):
            return m.group(0)
        local = _fetch_to_memory(
            m.group(3), store, failures, max_per_file, max_total,
            fetch_timeout, allow_domains, block_domains,
            deadline=(t_start + wall_cap_seconds) if wall_cap_seconds else None,
            slow_loads=slow_loads,
        )
        if local is None:
            return m.group(0)
        patched += 1
        post = _INTEGRITY_ATTR_RE.sub("", m.group(4))
        return f'<link{m.group(1)} href="{local}"{post}>'

    html = _SCRIPT_TAG_RE.sub(rewrite_script, html)
    if include_preload:
        html = _PRELOAD_TAG_RE.sub(rewrite_preload, html)

    # 还原注释
    for i, c in enumerate(parked):
        html = html.replace(f"<!--__BC_STASH_{i}__-->", c)
    return html, patched


def _detect_cdn_load_failures(localize_summary: Optional[dict]) -> list[str]:
    """基于"实际加载失败"事实信号给 CDN 换 CDN 建议。

    跟之前基于 host 黑名单的推断不同, 这里**只在 SKILL 内部实测下载失败时才报**:
      - localize.failures 里包含某个 ECharts CDN 的失败 → 报 [cdn-load-failed]

    这样海外用户用 jsdelivr 能正常加载时 (localize 成功, failures 空),
    SKILL 不打扰; 中国大陆用户 jsdelivr 卡死时, failures 有内容 → 报告 + 换 CDN 建议。

    原则: host 名字本身不是错误, 实际加载失败才是错误。
    """
    if not localize_summary:
        return []
    # 合并 failures (真失败) + slow_loads (成功但慢) — 两类都给 warning
    issues = (localize_summary.get("failures") or []) + (localize_summary.get("slow_loads") or [])
    if not issues:
        return []
    # chart 库 URL 关键字 — 任何 chart 库 CDN 失败都该 warn (含 Plotly/Chart.js/D3 等)
    CHART_LIB_KW = ("echarts", "plotly", "chart.js", "chartjs",
                    "d3.min", "d3@", "highcharts", "vega", "apexcharts")
    out: list[str] = []
    seen: set[str] = set()
    for f in issues:
        url = (f.get("url") or "").lower()
        if not any(kw in url for kw in CHART_LIB_KW):
            continue   # 非 chart 库 CDN 失败不在本 detector 范围
        # 任何 echarts CDN 加载失败都报, 不管是不是"黑名单" host
        # (海外可能用 jsdelivr 平常没事但某次失败也算事实信号)
        host_match = next((h for h in _CDN_RISKY if h in url), None)
        host_key = host_match or url.split("/")[2] if "//" in url else "unknown-host"
        if host_key in seen:
            continue
        seen.add(host_key)
        reason_note = f" ({_CDN_RISKY[host_match]})" if host_match else ""
        out.append(
            f"[cdn-load-failed] {host_key} 加载 chart 库失败"
            f"{reason_note} reason: {f.get('reason')}。"
            f"建议改用国内 CDN: "
            f'<script src="https://cdn.bootcdn.net/ajax/libs/echarts/5.5.0/echarts.min.js"></script>'
            f"  (其他候选: lib.baomitu.com / echarts.apache.org / "
            f"registry.npmmirror.com)。详见 references/chart-reference.md。"
        )
    return out


def _inject_early_error_listener(html: str) -> str:
    """在 HTML <head> 第一个标签后注入 early error listener。

    用途: 不依赖 daemon hook 注入时机, SKILL 自己装 window.error /
          unhandledrejection listener, 把错存到 window.__rewindEarlyErrors。
          run_browser_check 在拿 daemon page_errors 之后再 evaluate 取出来合并。

    位置策略:
        1. <head ...> 后立即 → 最早, 在所有其他 script 之前
        2. fallback: <html ...> 后 (HTML 缺 <head> 的极端情况)
        3. 最末兜底: HTML 开头
    """
    m = _HEAD_OPEN_TAG_RE.search(html)
    if m:
        return html[:m.end()] + "\n" + _EARLY_LISTENER_SNIPPET + html[m.end():]
    m = _HTML_OPEN_TAG_RE.search(html)
    if m:
        return html[:m.end()] + "\n" + _EARLY_LISTENER_SNIPPET + html[m.end():]
    return _EARLY_LISTENER_SNIPPET + html


def _stop_local_server(srv: subprocess.Popen) -> None:
    if srv.poll() is not None:
        with _state_lock:
            if srv in _ACTIVE_SERVERS:
                _ACTIVE_SERVERS.remove(srv)
        return
    try: srv.terminate()
    except OSError: pass
    try: srv.wait(timeout=2)
    except subprocess.TimeoutExpired: srv.kill()
    with _state_lock:
        if srv in _ACTIVE_SERVERS:
            _ACTIVE_SERVERS.remove(srv)


# ── 残留 tab 清理 ──────────────────────────────────────────────────────

def _cleanup_on_exit():
    """atexit / signal handler：清光所有残留 server 和 tab。线程安全。"""
    # 取快照（list 浅拷贝）避免遍历中其他线程改动
    with _state_lock:
        servers_snapshot = list(_ACTIVE_SERVERS)
        mem_servers_snapshot = list(_ACTIVE_MEM_SERVERS)
        tabs_snapshot = list(_ACTIVE_TABS)
    for srv in servers_snapshot:
        _stop_local_server(srv)
    for msrv in mem_servers_snapshot:
        _stop_memory_server(msrv)
    cli = _locate_wukong_cli()
    if cli:
        for tid in tabs_snapshot:
            try:
                # cleanup 阶段 — encoding 一致用 utf-8 防 Windows cp936 解码崩
                _run_no_pipe(
                    [cli, "browser_use", "call", "--json",
                     json.dumps({"action": "close_tab", "targetId": tid})],
                    timeout=_CLEANUP_TIMEOUT_SEC,
                    text=False,
                )
            except (subprocess.TimeoutExpired, OSError):
                pass
            with _state_lock:
                if tid in _ACTIVE_TABS:
                    _ACTIVE_TABS.remove(tid)


def _ensure_cleanup_hooked():
    """注册 atexit + SIGINT/SIGTERM 钩子。幂等且线程安全。"""
    global _CLEANUP_HOOKED
    with _state_lock:
        if _CLEANUP_HOOKED:
            return
        _CLEANUP_HOOKED = True   # 先翻 flag，避免重复注册（即便后续注册失败）
    atexit.register(_cleanup_on_exit)

    def _sig_handler(signum, frame):
        _cleanup_on_exit()
        signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _sig_handler)
        except (ValueError, OSError):
            pass  # 非主线程时 signal.signal 会 raise ValueError — 跳过即可，
                  # atexit 仍然有效，仅失去 SIGINT 即时清理能力


# ── 结果分析 ───────────────────────────────────────────────────────────

def _format_source_location(source: str) -> str:
    """把 'http://127.0.0.1:PORT/encoded%20name.html:LINE:COL' → '<filename>:LINE:COL'。
    便于模型直接定位到 HTML 哪一行。
    """
    if not source:
        return ""
    # 拆 line:col 后缀（最多 2 个尾部 :NUMBER）
    m = re.match(r'^(.*?)(:\d+(?::\d+)?)$', source)
    if not m:
        return source
    url_part, line_col = m.group(1), m.group(2)
    # 取最后一段路径并 URL 解码
    try:
        from urllib.parse import unquote
        last = url_part.rsplit("/", 1)[-1]
        return f"{unquote(last)}{line_col}"
    except Exception:
        return f"{url_part.rsplit('/', 1)[-1]}{line_col}"


def _summarize_stack(stack: str, max_frames: int = 2) -> str:
    """取 stack 前几帧 + 同样 URL→filename 化。空 → 空字符串。"""
    if not stack:
        return ""
    frames = [ln.strip() for ln in stack.splitlines() if ln.strip()][:max_frames]
    # 每帧里可能含 http://... URL，反编码
    cleaned = []
    for f in frames:
        cleaned.append(re.sub(
            r'http://127\.0\.0\.1:\d+/([^\s)]+)',
            lambda m: __import__('urllib.parse', fromlist=['unquote']).unquote(m.group(1).rsplit("/", 1)[-1]),
            f,
        ))
    return " | ".join(cleaned)


def _is_opaque_error(msg: str) -> bool:
    """识别因 CORS 跨域脚本而无法定位的笼统 'Script error.' 类消息。
    这类错误信息量极低且常因为 hover/resize 触发跨域 CDN 脚本的 catch-all
    handler 产生，难以判定是真 bug 还是浏览器策略，**不应据此标 fail**。
    """
    if not msg: return False
    s = msg.strip().lower()
    return s in ("script error.", "script error", "[object event]")


def _is_echarts_lifecycle_error(msg: str) -> bool:
    """识别 ECharts 内部 lifecycle 错（如 c.resize is not a function）。

    这类错误特征：
    - resize handler 内部对已销毁/未初始化的 chart 实例调 .resize()
    - 用户实测（case_030 trial-002）：错误存在但**图正常显示**，刷新后消失
    - 我们主动 dispatchEvent('resize') 触发，正常浏览器使用（不调 resize）也可能遇到
    - 单变量名（c/e/d 等）后跟 .resize/.dispose 是 ECharts minified 代码典型模式
    """
    if not msg: return False
    # 例: TypeError: c.resize is not a function
    # 例: TypeError: e.dispose is not a function. (In 'e.dispose()'...)
    import re
    return bool(re.search(r'\b[a-z]\.(resize|dispose|render|setOption)\s+is not a function',
                          msg, re.IGNORECASE))


def _analyse(diag, page_errors, console_errors,
             baseline_page_errors=None) -> tuple[bool, list[str], list[str]]:
    """分析渲染信号 → (ok, errors, warnings)。

    判定原则：**允许漏检不得误报**。
    - errors 才参与 ok 判定；warnings 仅提示不阻塞。
    - 信号必须具体可定位（line:col / chart id / 容器尺寸），不靠模糊启发式。

    baseline_page_errors: 历史遗留参数，保留兼容性但当前不使用 — baseline diff 机制
    实测对延迟报错的真 bug (case_007 next) 不安全。改用精确错误模式识别
    ECharts lifecycle 错（c.resize 类）降级。
    """
    errors: list[str] = []
    warnings: list[str] = []

    # ── page_errors ────
    # 删除 baseline diff 机制：实测 case_007 (next undefined) 偶发延迟报错被错分到
    # trigger-only warning。改为按**精确错误模式**识别 ECharts lifecycle 错。
    for e in page_errors or []:
        msg = e.get("message", "")
        src = e.get("source", "")
        loc = _format_source_location(src)
        stack_brief = _summarize_stack(e.get("stack", ""))
        # 跨域笼统错误（"Script error." 无定位）→ 跳过（无法定位 + 高 FP 风险）
        if _is_opaque_error(msg) and not loc.strip(":0"):
            continue
        parts = [f"[pageerror] {msg}"]
        if loc: parts.append(f"位置: {loc}")
        if stack_brief and stack_brief != loc: parts.append(f"调用栈: {stack_brief}")
        line = "  ".join(parts)
        # ECharts 内部 lifecycle 错（c.resize / e.dispose 等）→ warning 不参与 ok
        # 用户实测：case_030 t2 的 c.resize 报但图正常 (FP)
        if _is_echarts_lifecycle_error(msg):
            warnings.append(f"[echarts-lifecycle] {line}（ECharts 内部 resize/dispose 错，通常不影响渲染）")
        else:
            errors.append(line)

    # ── console_errors ────
    for m in console_errors or []:
        txt = m.get("message") or m.get("text") or str(m)
        if any(s in txt for s in ("favicon", "DevTools")): continue
        if _is_opaque_error(txt): continue
        # 纯版本/弃用告警（不影响渲染）→ warning 不 error
        # 例：plotly 'WARNING: plotly-latest.min.js ... NO LONGER the latest' (case_anal_039)
        stripped = txt.lstrip()
        if (stripped.startswith("WARNING:") or stripped.startswith("DEPRECATED:")
                or stripped.startswith("[Deprecation]")):
            warnings.append(f"[console.warn] {txt[:200]}")
            continue
        loc = _format_source_location(m.get("source", ""))
        errors.append(f"[console.error] {txt}" + (f"  位置: {loc}" if loc else ""))

    # ── diag 信号（仅基于 chart 实例的具体证据，不靠 chart-div / lib 启发式）────
    # 模型用 PNG/Plotly 替代 ECharts 是 workflow 策略问题, 不是用户感知的"明确错误"
    # (PNG 仍能渲染出图, 用户能看到内容; 失去交互是 SKILL workflow 期望, 不是渲染错)。
    # 按"只管明确错误, 不管模型选择"原则, 一律降为 warning 不参与 ok 判定。
    if diag:
        echarts_count = diag.get("echartsCount", 0)
        chart_div = diag.get("chartLikeContainers", 0)
        img_count = diag.get("staticImgCount", 0)
        if echarts_count == 0 and chart_div > 0 and img_count > 0:
            severity = ("多 chart 占位 + 多静态图 (高概率 matplotlib/PIL 替代)"
                        if chart_div >= 2 and img_count >= 2
                        else "单图场景 (可能是合理插图)")
            warnings.append(
                f"[no-chart-lib] 页面含 {chart_div} 个 chart 占位 div + "
                f"{img_count} 张静态图片，{severity}。如 prompt 要求交互图表请改 ECharts。"
            )

        for inst in diag.get("instances", []):
            cid = inst.get("id") or "<no-id>"
            # display:none 祖先（tab/折叠 UI）合法：跳过 layout 检查但仍校验数据
            if (inst["width"] == 0 or inst["height"] == 0) and not inst.get("hiddenByAncestor"):
                errors.append(f"chart '{cid}' 容器尺寸 {inst['width']}x{inst['height']}（layout 异常）")
            # 新增: ECharts 实例存在但 series=[] —— 模型漏了 setOption 或 setOption 失败,
            # 用户视觉上是白块。修复 FN 路径 (case_022_four_level: 6 chart 里 1 个空)。
            # 通用安全:chart 实例创建 = 容器有, series=[] = 必然白图, 不存在合法 placeholder
            # (data-report SKILL 期望产物是 final 报告, 不应有空 chart)。
            series_arr = inst.get("series") or []
            if not series_arr and not inst.get("hiddenByAncestor"):
                errors.append(
                    f"chart '{cid}' 无 series 配置（chart 实例创建但 series=[]，"
                    f"模型缺 setOption 或 setOption 失败）— 渲染白图"
                )
                continue
            for s in series_arr:
                if s["dataLen"] == 0:
                    errors.append(f"chart '{cid}' series.{s['type']}.data=[] (空数据)")
                elif s["dataLen"] == -1:
                    errors.append(f"chart '{cid}' series.{s['type']}.data=null")
                else:
                    # series.data 长度有但实际全是 null/NaN/非数字 → chart 渲染白图
                    # 实测背景：case_030 monthlyChart series_len=2 但渲染空白，
                    # 因为 data 是 [null, null] 或全 0 类
                    numeric = s.get("numericCount", -1)
                    if numeric == 0:
                        errors.append(
                            f"chart '{cid}' series.{s['type']}.data 共 {s['dataLen']} 项但"
                            f"无有效数值（全 null/NaN/非数字）— 渲染白图"
                        )
                    elif s["dataLen"] >= 5 and s.get("nonZeroCount", -1) == 0 and numeric > 0:
                        # 全 0 数据 — 边界场景: 可能是模型未填充 (bug), 也可能是数据真为 0 (合法,
                        # 例如某地区销量真 0 / 某月库存真 0)。视觉上 bar 全 0=白图 / line 全 0=直线,
                        # 但用户报告里真 0 是合法内容, 单靠数值无法判别模型异常 vs 真 0。
                        # 按"只管明确错误, 不管模型选择"原则降为 warning。
                        warnings.append(
                            f"[all-zero-data] chart '{cid}' series.{s['type']}.data 共 "
                            f"{s['dataLen']} 项数值全为 0 — 可能数据未填充, 也可能真为 0"
                        )
            for ax in inst.get("xAxis", []):
                if ax["dataLen"] == 0:
                    errors.append(f"chart '{cid}' xAxis.data=[] (空轴标签)")

        # ── orphan chart div: 有 id 的 chart/figure 容器但未被 echarts init ──
        # 4 重启发式过滤已在 DIAG_FN 中执行 (已 init / 子节点 canvas|svg / 实质内容 / 尺寸>=80x50)
        # 真实评测核实: case_049 标 7/9 真白, case_042 标 4/4 真白, 0% 误报
        orphans = diag.get("orphanChartDivs") or []
        if orphans:
            ids = [o.get("id") for o in orphans]
            errors.append(
                f"orphan_chart_div: {len(orphans)} 个 chart 容器未渲染 (有 id 但无 echarts.init): "
                f"{ids[:8]}{' ...' if len(ids) > 8 else ''} — 用户视觉上是白图。"
                f"修复: 给每个容器加 echarts.init(document.getElementById('<id>')).setOption({{...}})."
            )

    ok = len(errors) == 0
    return ok, errors, warnings


# ── 公开入口 ───────────────────────────────────────────────────────────

def run_browser_check(
    html_path: str | Path,
    timeout: float = _DEFAULT_TOTAL_TIMEOUT,
    server_root: Optional[Path] = None,
    *,
    localize: str = "memory",
    localize_fallback: str = "off",
    localize_include_preload: bool = True,
    localize_allow_domains: Optional[set[str]] = None,
    localize_block_domains: Optional[set[str]] = None,
    localize_max_per_file_mb: int = 5,
    localize_max_total_mb: int = 20,
    localize_fetch_timeout_sec: int = 20,
) -> Optional[dict[str, Any]]:
    """对单个 HTML 做真渲染校验。

    返回 None 表示 wukong-cli 或 daemon 不可用，调用方应降级为纯静态校验。

    Parameters
    ----------
    localize : "memory" (default) | "off"
        是否本地化跨域 <script src=>。默认 "memory" — HTML 加载前正则扫所有跨域
        script, 下载到内存, 改写为同源路径。绕开 WKWebView 的 "Script error." 脱敏,
        让 daemon 拿到完整 JS 错 message + stack。
        "off" 保留旧行为(走 CDN, 错被脱敏成 "Script error.")。
    localize_fallback : "off" (default) | "error"
        memory 模式致命失败(server 起不来 / localize 内部异常 / HTML 读失败)的兜底:
        - "off" : 自动退回 file server 模式跑原 HTML, 至少拿到 8 项静态 + detector
                  (JS 错仍脱敏, 但 validate 不整体崩)
        - "error" : 严格模式, 直接返回 _err_result (CI/评测需确定性时用)
        单 CDN 下载失败不触发本 fallback (已被 _localize_in_memory 内部容错处理)。
    localize_allow_domains / localize_block_domains : set[str] | None
        white/black 列表(host 字符串集)。None 默认替换所有跨域 script。
    localize_max_per_file_mb / localize_max_total_mb : int
        单文件 / 总下载内存上限。超限拒绝下载, 保留原 src。
    localize_fetch_timeout_sec : int
        单 URL 下载超时。

    成功时返回 dict:
        {
          ok: bool,
          source: "wukong-browser",
          issues: list[str],       # 人类可读问题（拼到上游 errors）
          page_errors: list[{msg, source}],
          console_errors: list[str],
          echarts: {echartsCount, chartLikeContainers, ..., instances: [...]},
          elapsed_ms: int,
          localize: {              # localize="off" 时为 None
            mode: "memory",
            patched_scripts: int,  # 改写的 <script>/<link> 数
            downloaded_kb: int,    # 内存 store 总大小
            failures: [{url, reason}],  # 未 localize 成功的 (仍跨域, 错继续脱敏)
          } | None,
        }
    """
    cli = _locate_wukong_cli()
    if not cli:
        # 降级:CLI 不可用,html_report.py 会读 get_locate_diag() 拿详细原因传到 transcript
        return None
    if not _probe_daemon(cli):
        # CLI 在但 daemon 不可用 (服务未启动 / 探活超时)
        # 同样降级到纯静态校验,html_report.py 会标 unavailable
        return None

    p = Path(html_path).resolve()
    if not p.is_file():
        return {
            "ok": False, "source": "wukong-browser",
            "issues": [f"文件不存在: {p}"],
            "page_errors": [], "console_errors": [], "echarts": {},
            "elapsed_ms": 0,
        }

    _ensure_cleanup_hooked()
    t0 = time.time()

    # 读一次 HTML — memory 模式 localize 用得到, 同时供 CDN 白名单检测
    try:
        raw_html = p.read_text(encoding="utf-8")
    except Exception as e:
        return _err_result(t0, f"读 HTML 失败: {e}")

    # CDN 检测先初始化为空, localize 跑完后基于 localize_summary.failures 填充
    # (基于"实际加载失败"事实信号, 不基于 host 黑名单推断 — 海外用户用 jsdelivr 不误报)
    cdn_warnings: list[str] = []

    # ── server 模式分支 ──
    use_memory = (localize == "memory")
    localize_summary: Optional[dict[str, Any]] = None
    mem_srv: Optional[_ThreadingMemoryServer] = None
    file_srv: Optional[subprocess.Popen] = None

    if use_memory:
        # 内存 server: 把 HTML + localized CDN 都装进 store, 同 origin 提供。
        # 不写磁盘临时文件, 进程退出即释放。
        memory_fatal: Optional[str] = None
        try:
            store: dict[str, tuple[bytes, str]] = {}
            failures: list[dict] = []
            slow_loads: list[dict] = []
            # localize wall cap = timeout 一半, 留另一半给 daemon (open_tab + 渲染)
            # 否则慢 CDN 串行下载会吃光 timeout, 后续 _call 看到 deadline 已过直接 fail
            patched_html, n_patched = _localize_in_memory(
                raw_html, store, failures,
                include_preload=localize_include_preload,
                allow_domains=localize_allow_domains,
                block_domains=localize_block_domains,
                max_per_file=localize_max_per_file_mb * 1024 * 1024,
                max_total=localize_max_total_mb * 1024 * 1024,
                fetch_timeout=localize_fetch_timeout_sec,
                wall_cap_seconds=timeout / 2,
                slow_loads=slow_loads,
            )
            # 注入 early-error listener — 绕开 daemon hook 注入时机问题
            # (Windows WebView2 上 daemon hook 装上之前的错全丢, SKILL 自己装 listener 兜底)
            patched_html = _inject_early_error_listener(patched_html)
            html_key = f"/{p.name}"
            store[html_key] = (patched_html.encode("utf-8"), "text/html; charset=utf-8")
            mem_srv, port = _start_memory_server(store)
            url_path = urllib.parse.quote(p.name)
            localize_summary = {
                "mode": "memory",
                "patched_scripts": n_patched,
                "downloaded_kb": sum(len(b) for b, _ in store.values()) // 1024,
                "failures": failures,
                "slow_loads": slow_loads,
                "fatal_fallback": None,
            }
            # localize 跑完即填 cdn_warnings — 这样后续 _err_result 路径也能透出
            cdn_warnings = _detect_cdn_load_failures(localize_summary)
        except Exception as e:
            memory_fatal = f"{type(e).__name__}: {e}"

        if memory_fatal is not None:
            if localize_fallback == "error":
                return _err_result(t0, f"内存模式失败: {memory_fatal}", warnings=cdn_warnings)
            # fallback="off": 退回 file server 模式跑原 HTML
            # JS 错仍脱敏, 但 8 项静态 + chart detector 仍有效, 不至于 validate 整体崩
            root = server_root or p.parent
            try:
                file_srv, port = _start_local_server(root)
                rel = p.relative_to(root)
                url_path = "/".join(urllib.parse.quote(seg) for seg in rel.parts)
            except (RuntimeError, ValueError) as e2:
                return _err_result(
                    t0, f"内存模式失败 ({memory_fatal}) 且 fallback 也失败 ({e2})"
                )
            localize_summary = {
                "mode": "memory→off (fallback)",
                "patched_scripts": 0,
                "downloaded_kb": 0,
                "failures": [],
                "fatal_fallback": memory_fatal,
            }
    else:
        # 原 tempfile 模式: 起子进程 http.server, 根目录是 HTML 所在父目录
        root = server_root or p.parent
        try:
            file_srv, port = _start_local_server(root)
        except RuntimeError as e:
            return _err_result(t0, f"http server 启动失败: {e}", warnings=cdn_warnings)

        try:
            rel = p.relative_to(root)
        except ValueError:
            _stop_local_server(file_srv)
            return _err_result(t0, f"HTML 路径 {p} 不在 server_root {root} 下", warnings=cdn_warnings)
        url_path = "/".join(urllib.parse.quote(seg) for seg in rel.parts)

    url = f"http://127.0.0.1:{port}/{url_path}"

    target_id: Optional[str] = None
    deadline = t0 + timeout
    try:
        opened = _call(cli, "open_tab", deadline=deadline, url=url)
        if "_error" in opened:
            return _err_result(t0, f"open_tab 失败: {opened.get('_error')}", warnings=cdn_warnings, localize=localize_summary)
        target_id = opened.get("target", {}).get("current")
        if not target_id:
            return _err_result(t0, "open_tab 未返回 targetId", warnings=cdn_warnings, localize=localize_summary)
        with _state_lock:
            _ACTIVE_TABS.append(target_id)

        # wait_for: 固定 5s（daemon 侧 timeoutMs）— networkidle 在外部资源
        # (CDN) 不稳定时可能永远达不到，长 timeout 会拖死全流程且耽误后续
        # get_page_errors 抓取。5s 足够大多数 HTML 完成首轮渲染。
        _call(cli, "wait_for", deadline=deadline,
              loadState="networkidle", timeoutMs=_WAIT_FOR_NETWORKIDLE_MS,
              targetId=target_id)
        if time.time() >= deadline:
            return _err_result(t0, f"整体超时（>{timeout:.1f}s, after wait_for）", warnings=cdn_warnings, localize=localize_summary)
        # WebKit 下让 layout 稳一稳（消除 0x0 假阳性）
        time.sleep(_LAYOUT_SETTLE_SEC)

        # baseline 快照：trigger 前的 page_errors。后续与 trigger 后的 errors 做 diff，
        # 新增的判定为 trigger 引发（resize/hover 才报，未必影响真实渲染），降级 warning。
        # 实测背景：case_030 t2 用户已确认 c.resize 错存在但**图正常**，刷新后消失 — FP。
        # 注意 clear=False：daemon 默认行为下，调 get_page_errors 会清空 history —
        # 拍 baseline 后 after 调用就拿不到原本就有的 page errors（如 case_007 的 next undefined），
        # 必须显式 clear=False 保留 history 让后续 after 抓全。
        baseline_errs = _call(cli, "get_page_errors", deadline=deadline,
                              targetId=target_id, includePreviousNavigations=True,
                              clear=False)
        baseline_page_errors = (baseline_errs.get("result", {}) or {}).get("errors", []) or []

        # 主动触发懒发错误：resize + 每个可见 chart hover。
        # 让 ECharts resize handler / tooltip formatter 内的错误也进 pageerror history。
        _call(cli, "evaluate", deadline=deadline, fn=TRIGGER_FN, targetId=target_id)
        time.sleep(_TRIGGER_SETTLE_SEC)

        # includePreviousNavigations=true：抓全 navigation history（防 daemon 闪烁性
        # 漏抓——观察到 case_analytics_030 'df is not defined' 偶发返回空 errors）
        errs = _call(cli, "get_page_errors", deadline=deadline,
                     targetId=target_id, includePreviousNavigations=True,
                     clear=False)
        page_errors = (errs.get("result", {}) or {}).get("errors", []) or []

        cons = _call(cli, "get_console_messages", deadline=deadline,
                     level="error", targetId=target_id,
                     includePreviousNavigations=True)
        console_errors = (cons.get("result", {}) or {}).get("messages", []) or []

        # 拿 SKILL 自己注入的 early-listener buffer (仅 memory 模式注入了)
        # 这层 listener 在 <head> 第一行就装上, 不依赖 daemon hook 时机,
        # 能接住 hook 装上前发生的错 (尤其 Windows WebView2 上 hook lazy install 漏抓的)
        early_errors_raw: list = []
        if use_memory:
            early_ev = _call(
                cli, "evaluate", deadline=deadline,
                fn="() => (window.__rewindEarlyErrors || []).slice(0, 100)",
                targetId=target_id,
            )
            early_errors_raw = (early_ev.get("result", {}) or {}).get("response", []) or []

        # 把 early errors 转成 daemon page_errors schema, dedup 后合并
        existing_msgs = set()
        for e in page_errors:
            m = (e.get("message") or "").strip()
            if m:
                existing_msgs.add(m)
        for ee in early_errors_raw:
            if not isinstance(ee, dict):
                continue
            msg = (ee.get("message") or "").strip()
            if not msg or msg in existing_msgs:
                continue
            file = ee.get("filename") or ""
            line = ee.get("lineno") or 0
            col = ee.get("colno") or 0
            source = f"{file}:{line}:{col}" if file else ""
            page_errors.append({
                "message": msg,
                "source": source,
                "stack": ee.get("stack") or "",
                # 标记来源, 便于排查
                "_origin": "early-listener",
            })
            existing_msgs.add(msg)

        ev = _call(cli, "evaluate", deadline=deadline, fn=DIAG_FN, targetId=target_id)
        diag = (ev.get("result", {}) or {}).get("response", {}) or {}

        # 闪烁修补：当 daemon 偶发不返回 page_errors 时无条件 retry 一次。
        # 8 并发跑批时实测：单测能稳定抓 next/df 等 REF_ERR，但并发场景下偶发返回空 errors —
        # 不依赖 chartLibLoaded/echartsCount 启发式（之前 retry 只覆盖"chart 没挂载"分支，
        # 漏掉了 chart 已挂载但仍有 pageerror 的情况，如 case_007 next is not defined）。
        if (not page_errors and not console_errors
                and time.time() < deadline - _PAGEERROR_RETRY_DELAY_SEC):
            time.sleep(_PAGEERROR_RETRY_DELAY_SEC)
            errs2 = _call(cli, "get_page_errors", deadline=deadline,
                          targetId=target_id, includePreviousNavigations=True,
                          clear=False)
            page_errors = (errs2.get("result", {}) or {}).get("errors", []) or []

        ok, issues, warnings_list = _analyse(diag, page_errors, console_errors,
                                              baseline_page_errors=baseline_page_errors)
        # localize 细节不透传到 warnings — 模型只看 issues / page_errors 的标准语义,
        # localize 是 SKILL 内部机制, 仅存 result["localize"] 字段供开发者诊断 / transcript dump
        # CDN 加载失败提示 — 基于 localize.failures 事实信号 (前面 localize 跑完时已填),
        # 海外用户用 jsdelivr 加载成功 → failures 空 → 不报; 国内卡死 → 报换 CDN 建议
        if cdn_warnings:
            warnings_list = list(warnings_list) + cdn_warnings
        return {
            "ok": ok,
            "source": "wukong-browser",
            "issues": issues,
            "warnings": warnings_list,
            "page_errors": [{"msg": e.get("message"), "source": e.get("source")} for e in page_errors],
            "console_errors": [m.get("message") or m.get("text") for m in console_errors],
            "echarts": diag,
            "elapsed_ms": int((time.time() - t0) * 1000),
            "localize": localize_summary,
        }
    finally:
        if target_id:
            # 释放 renderer 内存：close_tab 前 dispose 所有 ECharts 实例 + 清空 DOM。
            # 根因：daemon 复用同一个 renderer 进程服务所有 tab，close_tab 只销毁 tab
            # 不销毁 renderer 内 JS heap/canvas 累积。不 dispose → 每 tab 残留数十 MB
            # → 100+ case 后 renderer 从 200MB 线性涨到 20GB（Windows 实测 evalrun 复现）。
            try:
                _call(cli, "evaluate", deadline=time.time() + _CLEANUP_TIMEOUT_SEC,
                      fn="(()=>{try{if(typeof echarts!=='undefined'){"
                         "document.querySelectorAll('[_echarts_instance_]')"
                         ".forEach(el=>{try{echarts.dispose(el)}catch(e){}})}"
                         "document.body.innerHTML=''}catch(e){}})()",
                      targetId=target_id)
            except Exception:
                pass
            # cleanup 阶段不参与全局 deadline（即使 deadline 已过仍要尝试清理），
            # 但有独立短超时防 hang
            _call(cli, "close_tab", deadline=time.time() + _CLEANUP_TIMEOUT_SEC,
                  targetId=target_id)
            with _state_lock:
                if target_id in _ACTIVE_TABS:
                    _ACTIVE_TABS.remove(target_id)
        if mem_srv is not None:
            _stop_memory_server(mem_srv)
        if file_srv is not None:
            _stop_local_server(file_srv)


def _err_result(t0: float, msg: str,
                warnings: Optional[list[str]] = None,
                localize: Optional[dict] = None) -> dict[str, Any]:
    """daemon 调用失败 / deadline exceeded 等所有降级路径的统一返回。

    warnings: 静态扫描已经拿到的 warnings (如 CDN 白名单检测) — 即使 daemon 跑挂,
              这些静态信号仍要透出给模型, 不能丢。
    localize: 已经跑过的 localize summary (含 failures / mode), 方便排查。
    """
    return {
        "ok": False, "source": "wukong-browser",
        "issues": [msg], "warnings": list(warnings or []),
        "page_errors": [], "console_errors": [], "echarts": {},
        "elapsed_ms": int((time.time() - t0) * 1000),
        "localize": localize,
    }


# ── CLI（独立使用 / 调试）──────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="单独跑 daemon 真渲染校验")
    ap.add_argument("html", help="HTML 文件路径")
    ap.add_argument("--timeout", type=float, default=15)
    ap.add_argument("--localize", choices=("memory", "off"), default="memory",
                    help="跨域 <script src=> 本地化模式 (默认 memory: 下载到内存同源, "
                         "解锁 JS 错完整 message; off: 走原 CDN, 错被脱敏成 'Script error.')")
    ap.add_argument("--localize-fallback", choices=("off", "error"), default="off",
                    help="memory 致命失败的兜底 (默认 off: 退回 file server 跑原 HTML; "
                         "error: 严格模式直接报错)")
    ap.add_argument("--localize-allow", default=None,
                    help="只 localize 这些 host (逗号分隔), 默认全部")
    ap.add_argument("--localize-block", default=None,
                    help="跳过这些 host (逗号分隔)")
    ap.add_argument("--no-localize-preload", action="store_true",
                    help="不处理 <link rel=preload as=script>")
    ap.add_argument("--localize-max-per-file-mb", type=int, default=5)
    ap.add_argument("--localize-max-total-mb", type=int, default=20)
    ap.add_argument("--localize-fetch-timeout", type=int, default=20)
    ns = ap.parse_args()
    allow = set(s.strip() for s in ns.localize_allow.split(",") if s.strip()) \
        if ns.localize_allow else None
    block = set(s.strip() for s in ns.localize_block.split(",") if s.strip()) \
        if ns.localize_block else None
    r = run_browser_check(
        ns.html, timeout=ns.timeout,
        localize=ns.localize,
        localize_fallback=ns.localize_fallback,
        localize_include_preload=not ns.no_localize_preload,
        localize_allow_domains=allow,
        localize_block_domains=block,
        localize_max_per_file_mb=ns.localize_max_per_file_mb,
        localize_max_total_mb=ns.localize_max_total_mb,
        localize_fetch_timeout_sec=ns.localize_fetch_timeout,
    )
    if r is None:
        print(json.dumps({"ok": None, "reason": "wukong-cli 或 daemon 不可用，请确认 wukong service 已启动"},
                         ensure_ascii=False, indent=2))
        sys.exit(2)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r["ok"] else 1)
