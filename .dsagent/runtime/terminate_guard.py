"""
terminate_guard.py —— 跨平台「优雅终止」钩子（2026-11-19）

════════════════════════════════════════════════════════════════════════
为什么需要这个文件
════════════════════════════════════════════════════════════════════════
事故：拼多多推广技能连续失败 30+ 次，每次都是「技能 60 秒无输出，按 idle 超时终止」。
根因之一是终止方式：父进程（skill-service 看门狗）用 SIGKILL 杀子进程，
**SIGKILL 无法被捕获**，脚本的 finally / atexit / 清理逻辑全部不执行 →
账号锁文件留在盘上、Chrome 进程不关、临时状态不写回 →
下一次调用读到残留锁，等待 300 秒且期间无输出 → 又被杀 → 死循环。

修复分两层：
  ① 基座层（已改）：软阈值只告警、硬阈值先尝试优雅终止；
  ② 脚本层（本文件）：**主动配合** —— 监听 stdin 的终止指令，收到就清理。

为什么不用信号：
  Windows 上 Node / Python 都没有真正的 SIGTERM 投递。
  实测：child.kill('SIGTERM') 会直接 TerminateProcess，脚本里的
  signal.signal(SIGTERM, ...) 处理器**不会执行**。所以信号方案在 Windows 上无效。

协议：
  父进程往子进程 stdin 写一行：__DSAGENT_TERMINATE__
  子进程读到后：执行已注册的清理函数 → 正常 sys.exit(143)

  用 stdin 而不是信号，是因为 stdin 管道在全平台都可靠，
  且 Python/Node 都能非阻塞读取。

用法（技能脚本里按需注册清理动作）：
    from .dsagent.runtime import on_terminate
    on_terminate(lambda: release_lock())
  ★ 不注册也可以 —— 进程退出时 atexit 仍会跑，锁有 PID 存活兜底。
"""

from __future__ import annotations

import atexit
import os
import sys
import threading
from typing import Callable, List

SENTINEL = "__DSAGENT_TERMINATE__"

_handlers: List[Callable[[], None]] = []
_installed = False
_lock = threading.Lock()


def on_terminate(fn: Callable[[], None]) -> None:
    """注册一个清理函数（在收到终止指令或正常退出时执行）。"""
    if callable(fn):
        with _lock:
            _handlers.append(fn)


def _run_handlers() -> None:
    with _lock:
        handlers = list(_handlers)
    for fn in handlers:
        try:
            fn()
        except Exception:  # noqa: BLE001 —— 清理失败不能掩盖真实退出原因
            pass


def _watch_stdin() -> None:
    """后台线程：读 stdin，收到终止指令就清理并退出。"""
    try:
        stream = sys.stdin
        if stream is None:
            return
        for raw in iter(stream.readline, ""):
            if not raw:
                break
            if raw.strip() == SENTINEL:
                _run_handlers()
                try:
                    sys.stderr.write("[terminate-guard] 收到终止指令，已清理并退出\n")
                    sys.stderr.flush()
                except Exception:  # noqa: BLE001
                    pass
                os._exit(143)
    except Exception:  # noqa: BLE001
        # stdin 被关闭 / 不是管道 / 编码问题 —— 都不影响主流程
        return


def install_terminate_guard() -> bool:
    """安装钩子（幂等）。返回是否本次真的装上了。"""
    global _installed
    if _installed:
        return False
    _installed = True

    # 正常退出路径也跑一遍清理（atexit 对 SIGKILL 无效，但对正常结束有效）
    atexit.register(_run_handlers)

    # 只在 stdin 是管道时监听：交互式终端下不抢用户输入
    try:
        if sys.stdin is not None and not sys.stdin.isatty():
            t = threading.Thread(target=_watch_stdin, name="dsagent-terminate-guard", daemon=True)
            t.start()
    except Exception:  # noqa: BLE001
        pass
    return True
