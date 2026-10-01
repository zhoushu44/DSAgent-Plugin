"""
DSAgent runtime 导出注册表 — 技能侧统一入口。

技能脚本通过以下方式使用：
    import sys, os
    _dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
    if _dsagent_dir and _dsagent_dir not in sys.path:
        sys.path.insert(0, _dsagent_dir)
    from runtime.dsagent_runtime import log, output_result, output_summary
    from runtime.dsagent_runtime import fetch_binding_context, http_get, http_post, mtop_jsonp
    from runtime.dsagent_runtime import BindingContextError, PlatformRequestError
    from runtime.dsagent_runtime import CallThrottle, call_json_with_retries
    from runtime.dsagent_runtime import (
        FAILURE_RISK, FAILURE_TOKEN, FAILURE_RATE, FAILURE_PARSE, FAILURE_API,
        FAILURE_NOT_BOUND, FAILURE_ACCOUNT_CHOICE,
    )
    from runtime.dsagent_runtime import extract_keyword_from_request

或者更简洁地：
    from runtime.dsagent_runtime import *
"""

from .output import (
    log,
    output_result,
    output_files,
    output_summary,
    extract_keyword_from_request,
)
from .platform_client import (
    fetch_binding_context,
    http_get,
    http_post,
    mtop_jsonp,
    BindingContextError,
    PlatformRequestError,
    FAILURE_RISK,
    FAILURE_TOKEN,
    FAILURE_RATE,
    FAILURE_PARSE,
    FAILURE_API,
    FAILURE_NOT_BOUND,
    FAILURE_ACCOUNT_CHOICE,
)
from .http_retry import (
    CallThrottle,
    call_json_with_retries,
)
from .runtime_http import (
    api_base,
    require_token,
    require_agent_id,
    auth_headers,
    get_json,
    post_json,
)

__all__ = [
    # 输出
    "log", "output_result", "output_files", "output_summary",
    "extract_keyword_from_request",
    # 平台请求
    "fetch_binding_context", "http_get", "http_post", "mtop_jsonp",
    # 错误类型
    "BindingContextError", "PlatformRequestError",
    "FAILURE_RISK", "FAILURE_TOKEN", "FAILURE_RATE", "FAILURE_PARSE", "FAILURE_API",
    "FAILURE_NOT_BOUND", "FAILURE_ACCOUNT_CHOICE",
    # 重试/节流
    "CallThrottle", "call_json_with_retries",
    # HTTP 底层
    "api_base", "require_token", "require_agent_id", "auth_headers",
    "get_json", "post_json",
]
