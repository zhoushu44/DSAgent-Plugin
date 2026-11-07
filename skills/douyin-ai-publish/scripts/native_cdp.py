# -*- coding: utf-8 -*-
"""
原生 CDP 客户端 —— 绕开 Playwright 的连接失效问题

为什么不用 Playwright：
    实测抖店点「下一步」后，Chrome 里页面明明活着（/json/list 有 [page] /ffa/g/create），
    但 Playwright 的 connect_over_cdp 报 ctx.pages = 0（连接层失效）。
    而 /json/new、/json/list 这些 CDP HTTP 接口始终正常。

本模块直接：
    ① HTTP 查 /json/list 拿 targetId + webSocketDebuggerUrl
    ② websocket 连上去，发 CDP 命令（Runtime.evaluate / Input.dispatchMouseEvent / Page.navigate）
    ③ 页面换了就重新 /json/list 找新 target，重连

依赖：websocket-client（pip install websocket-client）
    没有的话退化用 websockets（asyncio），再没有就用 HTTP-only 模式（只能新建 tab，不能 evaluate）
"""
import json
import time
import urllib.request

try:
    import websocket  # websocket-client
    _HAS_WS = True
except ImportError:
    _HAS_WS = False


class CDPError(Exception):
    pass


class NativeCDP:
    """连到指定端口的 Chrome，直接发 CDP 命令"""

    def __init__(self, port=9444, verbose=False):
        self.port = port
        self.verbose = verbose
        self.ws = None
        self.target_id = None
        self._msg_id = 0

    # ─────────── HTTP 接口 ───────────
    def _http(self, path, method="GET", timeout=10):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        req = urllib.request.Request(url, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", errors="ignore")
        try:
            return json.loads(body)
        except Exception:
            return body

    def version(self):
        return self._http("/json/version")

    def list_targets(self):
        return self._http("/json/list")

    def pages(self):
        """返回所有 type=page 的 target（带 webSocketDebuggerUrl）"""
        try:
            ts = self.list_targets()
        except Exception:
            return []
        if not isinstance(ts, list):
            return []
        return [t for t in ts if t.get("type") == "page"]

    def new_tab(self, url="about:blank"):
        try:
            return self._http("/json/new?%s" % url, method="PUT", timeout=15)
        except Exception:
            return None

    def close_tab(self, target_id):
        try:
            return self._http("/json/close/%s" % target_id, timeout=10)
        except Exception:
            return None

    # ─────────── WebSocket ───────────
    def connect(self, target_id=None, prefer_url_contains="fxg.jinritemai.com/ffa/g/create"):
        """
        连到某个 page target。
        target_id 不传则自动挑：优先 URL 含 prefer_url_contains，其次内容最长的。
        """
        if not _HAS_WS:
            raise CDPError("缺 websocket-client，请 pip install websocket-client")

        pages = self.pages()
        if not pages:
            raise CDPError("没有 page target（Chrome 可能没打开任何页面）")

        chosen = None
        if target_id:
            chosen = next((p for p in pages if p.get("id") == target_id), None)
        if chosen is None:
            # 优先匹配 URL
            cands = [p for p in pages if prefer_url_contains and prefer_url_contains in (p.get("url") or "")]
            if not cands:
                cands = [p for p in pages if (p.get("url") or "") not in ("", "about:blank")]
            if not cands:
                cands = pages
            # 多个时逐个试 evaluate 看谁有内容
            best = None
            for p in cands:
                wsu = p.get("webSocketDebuggerUrl")
                if not wsu:
                    continue
                try:
                    n = self._probe_ws(wsu)
                    if n is not None and (best is None or n > best[0]):
                        best = (n, p)
                except Exception:
                    continue
            chosen = best[1] if best else cands[-1]

        wsu = chosen.get("webSocketDebuggerUrl")
        if not wsu:
            raise CDPError("target 无 webSocketDebuggerUrl: %s" % chosen.get("id"))

        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

        # ★ Chrome 会拒绝来自 http://127.0.0.1:PORT 的 origin（403）
        #   两种解法：① 启动加 --remote-allow-origins=*  ② 连接时 suppress_origin
        #   这里用 ②，不用改启动参数
        try:
            self.ws = websocket.create_connection(
                wsu, timeout=30, max_size=200 * 1024 * 1024, suppress_origin=True)
        except TypeError:
            self.ws = websocket.create_connection(wsu, timeout=30, max_size=200 * 1024 * 1024)
        self.target_id = chosen.get("id")
        self._msg_id = 0
        if self.verbose:
            print("  [CDP] 连上 target %s  %s" % (self.target_id, (chosen.get("url") or "")[:70]))
        return chosen

    def _probe_ws(self, wsu):
        """短连接探活：返回 bodyLen 或 None"""
        try:
            ws = websocket.create_connection(wsu, timeout=8, max_size=8 * 1024 * 1024, suppress_origin=True)
            try:
                ws.send(json.dumps({
                    "id": 1, "method": "Runtime.evaluate",
                    "params": {"expression": "(document.body && document.body.innerText || '').length",
                               "returnByValue": True}
                }))
                for _ in range(20):
                    msg = json.loads(ws.recv())
                    if msg.get("id") == 1:
                        return msg.get("result", {}).get("result", {}).get("value")
            finally:
                try:
                    ws.close()
                except Exception:
                    pass
        except Exception:
            return None
        return None

    def send(self, method, params=None, timeout=30, auto_reconnect=True):
        """发一条 CDP 命令，等对应 id 的响应。
        ★ 页面导航会让 WebSocket 断掉（ConnectionResetError）→ 自动重连后重试一次
        """
        if not self.ws:
            if auto_reconnect:
                self.connect()
            else:
                raise CDPError("未连接（先 connect()）")
        self._msg_id += 1
        mid = self._msg_id
        payload = {"id": mid, "method": method, "params": params or {}}
        try:
            self.ws.send(json.dumps(payload))
        except Exception as e:
            if not auto_reconnect:
                raise CDPError("send 失败: %s" % str(e)[:120])
            # 连接断了 → 重连后重试
            if self.verbose:
                print("  [CDP] 连接断开（%s），重连后重试 %s" % (str(e)[:50], method))
            time.sleep(1.5)
            self.connect()
            self._msg_id += 1
            mid = self._msg_id
            payload = {"id": mid, "method": method, "params": params or {}}
            self.ws.send(json.dumps(payload))
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                raw = self.ws.recv()
            except Exception as e:
                # 断线 → 重连，但这条命令的结果拿不到了，返回空
                if self.verbose:
                    print("  [CDP] recv 断开: %s" % str(e)[:60])
                try:
                    self.connect()
                except Exception:
                    pass
                raise CDPError("%s: 连接中断（页面可能已导航）" % method)
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if msg.get("id") == mid:
                if "error" in msg:
                    raise CDPError("%s: %s" % (method, json.dumps(msg["error"])[:200]))
                return msg.get("result", {})
        raise CDPError("%s 超时（%ds）" % (method, timeout))

    # ─────────── 常用封装 ───────────
    def eval(self, expr, await_promise=False, timeout=25):
        """执行 JS，返回 byValue 结果"""
        r = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
            "userGesture": True,
        }, timeout=timeout)
        # 检查异常
        if r.get("exceptionDetails"):
            d = r["exceptionDetails"]
            desc = (d.get("exception") or {}).get("description") or d.get("text") or "unknown"
            raise CDPError("JS 异常: " + str(desc)[:200])
        return (r.get("result") or {}).get("value")

    def eval_async(self, expr, timeout=40):
        """执行 async 函数（自动包成 Promise）"""
        return self.eval("(async () => { %s })()" % expr, await_promise=True, timeout=timeout)

    def click(self, x, y, retry=True):
        """
        真实鼠标点击（照抄 sku_build.py：move→press→release）

        ★ 抖店点「确认信息」后页面立刻开始导航，连接会断（WinError 10054）。
          点击本身可能已经送达，所以断线时**不重试**（避免重复点击），
          只把连接重建好给后续命令用。
        """
        try:
            self.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y}, auto_reconnect=False)
            time.sleep(0.12)
            self.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y,
                                                    "button": "left", "clickCount": 1, "buttons": 1},
                      auto_reconnect=False)
            time.sleep(0.08)
            self.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y,
                                                    "button": "left", "clickCount": 1, "buttons": 0},
                      auto_reconnect=False)
            return True
        except Exception as e:
            if self.verbose:
                print("  [CDP] click 期间断线（可能已送达）: %s" % str(e)[:70])
            # 重建连接，不重复点击
            time.sleep(1.5)
            try:
                self.connect()
            except Exception:
                pass
            return "maybe"

    def type_text(self, text, delay_ms=60):
        """真实键盘输入"""
        for ch in text:
            self.send("Input.dispatchKeyEvent", {"type": "char", "text": ch})
            time.sleep(delay_ms / 1000.0)

    def press_key(self, key):
        """按键（Enter 等）"""
        code = {"Enter": 13, "Escape": 27, "Tab": 9}.get(key, 0)
        self.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": key,
                                              "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code})
        self.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": key,
                                              "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code})

    def navigate(self, url, wait_sec=6):
        self.send("Page.navigate", {"url": url})
        time.sleep(wait_sec)

    def screenshot(self, path):
        r = self.send("Page.captureScreenshot", {"format": "png"})
        import base64
        with open(path, "wb") as f:
            f.write(base64.b64decode(r.get("data", "")))
        return path

    def wait_ready(self, timeout=60, poll=1.5):
        """等页面有 body 内容"""
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                n = self.eval("(document.body && document.body.innerText || '').length")
                if n and n > 50:
                    return n
            except Exception:
                # 连接可能断，尝试重连
                try:
                    self.connect()
                except Exception:
                    pass
            time.sleep(poll)
        return 0

    def close(self):
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None

    def drain_events(self, seconds=3.0, collect_methods=None):
        """
        排空 WebSocket 里挂起的 CDP 事件（同步 socket，只能主动读）。
        返回 {method: [params, ...]}
        """
        import json as _json
        want = set(collect_methods or [])
        out = {}
        t0 = time.time()
        old_to = None
        try:
            old_to = self.ws.gettimeout()
        except Exception:
            pass
        try:
            self.ws.settimeout(0.35)
        except Exception:
            pass
        while time.time() - t0 < seconds:
            try:
                raw = self.ws.recv()
            except Exception:
                continue
            try:
                msg = _json.loads(raw)
            except Exception:
                continue
            m = msg.get("method")
            if not m:
                continue
            if want and m not in want:
                continue
            out.setdefault(m, []).append(msg.get("params") or {})
        try:
            self.ws.settimeout(old_to if old_to else 30)
        except Exception:
            pass
        return out


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9444
    c = NativeCDP(port=port, verbose=True)
    print("version:", json.dumps(c.version(), ensure_ascii=False)[:200])
    ts = c.list_targets()
    print("targets: %d" % len(ts))
    for t in ts:
        print("  [%-16s] %s" % (t.get("type"), (t.get("url") or "")[:80]))
    pages = c.pages()
    if pages:
        print("\n连第一个 page...")
        c.connect()
        print("  bodyLen:", c.eval("(document.body && document.body.innerText || '').length"))
        print("  title:", c.eval("document.title"))
        c.close()
