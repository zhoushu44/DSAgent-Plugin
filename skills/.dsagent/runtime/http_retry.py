"""
DSAgent runtime 重试/节流 — 通用请求节流器 + 指数退避重试。

吸收 QIWork http_retry.py 的 CallThrottle 设计。
"""

from __future__ import annotations

import time
import random
from typing import Any, Callable


class CallThrottle:
    """
    请求节流器：保证两次调用之间最小间隔 + 随机抖动。

    用法：
        throttle = CallThrottle(min_interval=2.0, jitter=0.5)
        throttle.wait()  # 等待直到满足间隔
        result = some_api_call()
    """

    def __init__(self, min_interval: float = 2.0, jitter: float = 0.5):
        self.min_interval = min_interval
        self.jitter = jitter
        self._last_call = 0.0

    def wait(self) -> None:
        """阻塞等待直到满足最小间隔"""
        now = time.time()
        elapsed = now - self._last_call
        if elapsed < self.min_interval:
            sleep_time = self.min_interval - elapsed
            if self.jitter > 0:
                sleep_time += random.uniform(0, self.jitter)
            time.sleep(sleep_time)
        self._last_call = time.time()


def call_json_with_retries(
    fn: Callable[[], Any],
    *,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    retry_on: tuple = ("rate_limit",),
) -> Any:
    """
    带指数退避的 JSON 请求重试。

    fn: 返回 dict（含 status / failure_kind 字段）的函数。
    retry_on: 哪些 failure_kind 需要重试。

    用法：
        result = call_json_with_retries(
            lambda: http_get(url, platform="taobao"),
            retry_on=("rate_limit", "api_error"),
        )
    """
    from .platform_client import PlatformRequestError, FAILURE_TOKEN, FAILURE_RISK

    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            result = fn()
            if isinstance(result, dict) and result.get("status") == "error":
                kind = result.get("failure_kind", "")
                if kind in retry_on and attempt < max_retries:
                    delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                    time.sleep(delay)
                    continue
            return result
        except PlatformRequestError as e:
            last_error = e
            if e.failure_kind in retry_on and attempt < max_retries:
                delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                time.sleep(delay)
                continue
            raise
        except Exception as e:
            last_error = e
            # BindingContextError (token_expired/risk_control) 不应重试
            if hasattr(e, 'failure_kind') and e.failure_kind in (FAILURE_TOKEN, FAILURE_RISK):
                raise
            if attempt < max_retries:
                delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                time.sleep(delay)
                continue
            raise

    if last_error:
        raise last_error
