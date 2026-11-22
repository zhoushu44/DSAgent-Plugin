# DSAgent 通用 runtime 共享模块
#
# 此文件原本为空，仅标识包结构。
#
# ★ 2026-11-19：改为在 import 时自动安装「优雅终止」钩子（见 terminate_guard.py）。
#   背景：Windows 上 Node 的 kill('SIGTERM') 实际走 TerminateProcess，
#   子进程收不到信号、来不及清理 → 账号锁 / 浏览器 Profile 残留 →
#   后续每次调用都要白等一轮，最终表现为「技能反复超时」。
#   父进程改为往 stdin 写 __DSAGENT_TERMINATE__，这里读到就执行清理并正常退出。
#
#   ⚠️ 钩子失败绝不影响技能主流程；只在 stdin 是管道时安装。

try:
    from .terminate_guard import install_terminate_guard as _install_terminate_guard

    _install_terminate_guard()
except Exception:  # noqa: BLE001
    pass

__all__ = ["_install_terminate_guard"]
