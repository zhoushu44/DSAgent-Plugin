# -*- coding: utf-8 -*-
"""
CDP 端口被关的自愈方案

现象（实测 15 次）：
  点「下一步」→ 页面销毁 → Chrome 进程还在，但 9444 调试端口关闭
  → connect_over_cdp / websocket 全部失败

本模块提供两条自愈路径：

路径 A：端口重开探测
  Chrome 的调试端口关闭后，有些情况会重开（短暂窗口）
  → 轮询 /json/version，一旦通了立刻重连

路径 B：直接调 CDP HTTP 的 /json/new 复活
  即使 /json/version 暂时不通，/json/new 可能还能用
  → 用它新建 tab，再连新 tab

路径 C：先探测 Chrome 是否还活着
  活着 → 走 A/B
  死了 → 重启 Chrome 并恢复 cookie（最坏情况）

用法：
    from cdp_recover import CDPRecover
    rec = CDPRecover(port=9444, chrome_path=..., profile=...)
    ok = rec.ensure_alive(cookies=acct['cookies'])
    page = rec.new_tab('https://fxg.jinritemai.com/ffa/g/create')
"""
import json
import os
import sys
import subprocess
import time
import urllib.request

CHROME_DEFAULT = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


class CDPRecover:
    def __init__(self, port=9444, chrome_path=CHROME_DEFAULT, profile=None, log=None):
        self.port = port
        self.chrome_path = chrome_path
        self.profile = profile
        self.log = log or (lambda m: None)
        self.stats = {"reopen": 0, "newtab": 0, "restart": 0}

    # ─────────── 探测 ───────────
    def http_ok(self, timeout=2):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % self.port, timeout=timeout)
            return True
        except Exception:
            return False

    def chrome_alive(self):
        """Chrome 进程还在吗"""
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-c",
                 "(Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object).Count"],
                capture_output=True, text=True, timeout=10)
            n = int((r.stdout or "0").strip() or 0)
            return n > 0, n
        except Exception:
            return False, 0

    def port_owner(self):
        """9444 端口被谁占着"""
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-c",
                 "Get-NetTCPConnection -LocalPort %d -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique" % self.port],
                capture_output=True, text=True, timeout=10)
            pids = [p.strip() for p in (r.stdout or "").split() if p.strip().isdigit()]
            return pids
        except Exception:
            return []

    # ─────────── A：等端口重开 ───────────
    def wait_port_back(self, seconds=45, interval=0.8):
        self.log("  等调试端口重新打开（最多 %ds）" % seconds)
        t0 = time.time()
        while time.time() - t0 < seconds:
            if self.http_ok():
                self.stats["reopen"] += 1
                self.log("  ✅ 端口已恢复（%ds）" % int(time.time() - t0))
                return True
            time.sleep(interval)
        self.log("  ❌ 端口 %ds 未恢复" % seconds)
        return False

    # ─────────── B：用 /json/new 复活 ───────────
    def try_new_tab(self, url="about:blank"):
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:%d/json/new?%s" % (self.port, url), method="PUT")
            with urllib.request.urlopen(req, timeout=8) as r:
                body = r.read().decode("utf-8", errors="ignore")
            j = json.loads(body)
            self.stats["newtab"] += 1
            self.log("  ✅ /json/new 成功: %s" % (j.get("id") or "")[:12])
            return j
        except Exception as e:
            self.log("  /json/new 失败: %s" % str(e)[:60])
            return None

    # ─────────── C：重启 Chrome ───────────
    def restart_chrome(self, cookies=None):
        self.log("  ⚠️ 重启 Chrome")
        # 先杀掉残留
        try:
            subprocess.run(["powershell", "-NoProfile", "-c",
                            "Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        except Exception:
            pass
        time.sleep(5)

        # 清锁
        if self.profile:
            for lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
                fp = os.path.join(self.profile, lock)
                try:
                    if os.path.exists(fp):
                        os.remove(fp)
                except Exception:
                    pass

        args = [self.chrome_path,
                "--remote-debugging-port=%d" % self.port,
                "--user-data-dir=%s" % (self.profile or ""),
                "--no-first-run", "--no-default-browser-check", "about:blank"]
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         stdin=subprocess.DEVNULL, close_fds=True)

        for i in range(40):
            time.sleep(1)
            if self.http_ok():
                self.stats["restart"] += 1
                self.log("  ✅ Chrome 重启成功（%ds）" % (i + 1))
                if cookies:
                    self._inject_cookies(cookies)
                return True
        self.log("  ❌ Chrome 重启失败")
        return False

    def _inject_cookies(self, cookies):
        """重启后重新灌 cookie（用 CDP HTTP 拿 target 再发命令）"""
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from native_cdp import NativeCDP
            c = NativeCDP(port=self.port, verbose=False)
            c.connect()
            c.send("Network.enable", {})
            n = 0
            for k, v in (cookies or {}).items():
                if v in (None, ""):
                    continue
                try:
                    c.send("Network.setCookie", {"name": k, "value": str(v),
                                                 "domain": ".jinritemai.com", "path": "/"})
                    n += 1
                except Exception:
                    pass
            c.close()
            self.log("  已重新注入 %d cookie" % n)
            return n
        except Exception as e:
            self.log("  注 cookie 失败: %s" % str(e)[:60])
            return 0

    # ─────────── 主入口 ───────────
    def ensure_alive(self, cookies=None, wait=45):
        """确保 CDP 可用。返回 (ok, action)"""
        # ① 端口已经通
        if self.http_ok():
            return True, "already"

        alive, n = self.chrome_alive()
        self.log("  Chrome 进程 %d 个, 端口不通" % n)

        # ② Chrome 活着 → 等端口 + 试 /json/new
        if alive:
            if self.wait_port_back(seconds=wait):
                return True, "port-back"
            if self.try_new_tab():
                return True, "new-tab"
            # 都失败 → 重启
            return (True, "restart") if self.restart_chrome(cookies) else (False, "dead")

        # ③ Chrome 死了 → 重启
        return (True, "restart") if self.restart_chrome(cookies) else (False, "dead")


if __name__ == "__main__":
    print("CDPRecover 自检")
    r = CDPRecover(port=9444,
                   profile=r"C:\Users\Administrator\.dsh\browser-profiles\accounts\douyin_shop_7592d93baf0282259f7f6f9a03f1ced8",
                   log=lambda m: print("  " + m))
    print("  http_ok:", r.http_ok())
    a, n = r.chrome_alive()
    print("  chrome alive:", a, "n=", n)
    print("  port owner:", r.port_owner())
