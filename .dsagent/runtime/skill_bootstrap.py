"""Bridge module: delegates to runtime.dsagent_runtime / runtime.platform_client / platform_facade.

When _runtime.py adds .dsagent/runtime to sys.path, modules are imported
as top-level. This shim provides the skill_bootstrap API surface.
"""
from __future__ import annotations

_EXPORTS = {}

# ─── 基础 runtime 符号（dsagent_runtime）───
try:
    from dsagent_runtime import (
        log, output_result, output_files, output_summary,
        extract_keyword_from_request,
        fetch_binding_context, http_get, http_post, mtop_jsonp,
        BindingContextError, PlatformRequestError,
        FAILURE_RISK, FAILURE_TOKEN, FAILURE_RATE, FAILURE_PARSE, FAILURE_API,
        FAILURE_NOT_BOUND, FAILURE_ACCOUNT_CHOICE,
        CallThrottle, call_json_with_retries,
        api_base, require_token, require_agent_id, auth_headers, get_json, post_json,
    )
    _EXPORTS.update({
        "log": log, "output_result": output_result, "output_files": output_files,
        "output_summary": output_summary, "extract_keyword_from_request": extract_keyword_from_request,
        "fetch_binding_context": fetch_binding_context, "http_get": http_get,
        "http_post": http_post, "mtop_jsonp": mtop_jsonp,
        "BindingContextError": BindingContextError, "PlatformRequestError": PlatformRequestError,
        "FAILURE_RISK": FAILURE_RISK, "FAILURE_TOKEN": FAILURE_TOKEN,
        "FAILURE_RATE": FAILURE_RATE, "FAILURE_PARSE": FAILURE_PARSE,
        "FAILURE_API": FAILURE_API, "FAILURE_NOT_BOUND": FAILURE_NOT_BOUND,
        "FAILURE_ACCOUNT_CHOICE": FAILURE_ACCOUNT_CHOICE,
        "CallThrottle": CallThrottle, "call_json_with_retries": call_json_with_retries,
        "api_base": api_base, "require_token": require_token,
        "require_agent_id": require_agent_id, "auth_headers": auth_headers,
        "get_json": get_json, "post_json": post_json,
    })
except ImportError:
    pass

# ─── 平台门面符号（platform_facade）───
try:
    from platform_facade import (
        # SYCM
        SycmClient, SycmApiError, SycmRequestError,
        ApiPermissionError, ApiSessionExpiredError, get_sycm_client,
        # Alimama
        AlimamaInsightClient, AlimamaError, AlimamaRateLimitError,
        AuthInfo, get_alimama_client,
        # Taobao Mtop
        MtopCaller, TaobaoRequestError, TaobaoRateLimitError,
        TaobaoRiskControlError, TaobaoSessionExpiredError,
        # DMP
        DmpCompetitionClient, DmpError, DmpRateLimitError, get_dmp_client,
        # Taobao shop
        get_taobao_shop_key,
        # Cache
        WorkspaceCache,
    )
    _EXPORTS.update({
        "SycmClient": SycmClient, "SycmApiError": SycmApiError,
        "SycmRequestError": SycmRequestError,
        "ApiPermissionError": ApiPermissionError,
        "ApiSessionExpiredError": ApiSessionExpiredError,
        "get_sycm_client": get_sycm_client,
        "AlimamaInsightClient": AlimamaInsightClient,
        "AlimamaError": AlimamaError, "AlimamaRateLimitError": AlimamaRateLimitError,
        "AuthInfo": AuthInfo, "get_alimama_client": get_alimama_client,
        "MtopCaller": MtopCaller, "TaobaoRequestError": TaobaoRequestError,
        "TaobaoRateLimitError": TaobaoRateLimitError,
        "TaobaoRiskControlError": TaobaoRiskControlError,
        "TaobaoSessionExpiredError": TaobaoSessionExpiredError,
        "DmpCompetitionClient": DmpCompetitionClient,
        "DmpError": DmpError, "DmpRateLimitError": DmpRateLimitError,
        "get_dmp_client": get_dmp_client,
        "get_taobao_shop_key": get_taobao_shop_key,
        "WorkspaceCache": WorkspaceCache,
    })
except ImportError:
    pass


def resolve_export(name: str):
    if name in _EXPORTS:
        return _EXPORTS[name]
    raise AttributeError(f"skill_bootstrap has no export {name!r}")


def export_names() -> list[str]:
    return list(_EXPORTS.keys())


def facade_export_names() -> list[str]:
    """返回 platform_facade 中的符号名（用于 __dir__）"""
    names = []
    try:
        import platform_facade
        names = getattr(platform_facade, "__all__", [])
    except ImportError:
        pass
    return names


def read_skill_slug(pkg_root=None) -> str:
    import os
    base = os.path.basename(str(pkg_root)) if pkg_root else ""
    return base.replace("_", "-")


def workspace_root() -> str:
    import os
    return os.environ.get("DSAGENT_WORKSPACE", os.getcwd())
