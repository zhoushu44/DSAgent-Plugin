"""
DSAgent runtime 平台客户端 — 绑定检查、代理请求、错误类型。

所有平台 API 请求通过本地代理网关（gateway-proxy.ts）转发，
Cookie 由网关从 CredentialStore 取并注入。技能侧不接触原始 Cookie。

错误类型（吸收 QIWork failure_kind 设计）：
  FAILURE_RISK    — 风控拦截，需重新登录并完成验证
  FAILURE_TOKEN   — 登录态过期，需重新登录
  FAILURE_RATE    — 接口限流，稍后重试
  FAILURE_PARSE   — 响应解析失败
  FAILURE_API     — 通用 API 错误
  FAILURE_NOT_BOUND     — 平台未绑定账号
  FAILURE_ACCOUNT_CHOICE — 平台有多个可用账号且当前会话未绑定，需用户选择
"""

from __future__ import annotations

from typing import Any
from . import runtime_http


# ─── 错误类型常量 ───
FAILURE_RISK = "risk_control"
FAILURE_TOKEN = "token_expired"
FAILURE_RATE = "rate_limit"
FAILURE_PARSE = "parse_error"
FAILURE_API = "api_error"
FAILURE_NOT_BOUND = "not_bound"
FAILURE_ACCOUNT_CHOICE = "need_account_choice"


class BindingContextError(Exception):
    """账号未绑定或凭证缺失"""
    def __init__(self, message: str, *, platform: str = "", failure_kind: str = FAILURE_TOKEN,
                 accounts: list | None = None):
        super().__init__(message)
        self.platform = platform
        self.failure_kind = failure_kind
        # need_account_choice 时携带候选账号列表，交由模型向用户提问
        self.accounts = accounts or []


class PlatformRequestError(Exception):
    """平台请求失败"""
    def __init__(self, message: str, *, failure_kind: str = FAILURE_API, status_code: int = 0,
                 accounts: list | None = None):
        super().__init__(message)
        self.failure_kind = failure_kind
        self.status_code = status_code
        self.accounts = accounts or []


# ─── 平台提示文案 ───
_PLATFORM_HINTS: dict[str, str] = {
    "taobao": "请在「账号连接」页面绑定淘宝账号。",
    "xianyu": "请在「账号连接」页面绑定闲鱼账号（复用淘宝登录态）。",
    "sycm": "请在「账号连接」页面绑定生意参谋账号。",
    "douyin": "请在「账号连接」页面绑定抖音账号。",
    "xhs": "请在「账号连接」页面绑定小红书账号。",
    "xiaohongshu": "请在「账号连接」页面绑定小红书账号。",
    "zhihu": "请在「账号连接」页面绑定知乎账号。",
    "pinduoduo": "请在「账号连接」页面绑定拼多多账号。",
    "bilibili": "请在「账号连接」页面绑定 B 站账号。",
    "kuaishou": "请在「账号连接」页面绑定快手账号。",
}


def _hint_for(platform: str) -> str:
    return _PLATFORM_HINTS.get(platform, f"请在「账号连接」页面绑定 {platform} 账号。")


def fetch_binding_context(*, platform: str, shop_key: str = "") -> dict:
    """
    获取平台绑定上下文（不含 Cookie）。

    返回 {shop_key, platform, session_hint, display_label, tb_token}。

    未绑定、凭证过期、需用户选号时抛出 BindingContextError，
    异常上的 failure_kind 标识具体原因（need_account_choice 时 accounts 为候选列表）。
    """
    aid = runtime_http.require_agent_id()
    hint = _hint_for(platform)

    params = {"platform": platform, "agent_id": aid, "include_cookie": "false"}
    # 显式指定账号：网关据此走「显式 shopKey」这一级，避免重新走选择链。
    # 未显式传参时用环境变量里已选定的账号（host 预检确定），保证与网关选到同一个号。
    shop_key = shop_key or runtime_http.optional_shop_key()
    if shop_key:
        params["shop_key"] = shop_key

    data = runtime_http.get_json(
        "/api/v1/accounts",
        params=params,
        timeout=8.0,
    )

    # 平台有多个可用账号且当前会话未绑定：不静默选择，把候选交给上层问用户
    if data and data.get("failure_kind") == FAILURE_ACCOUNT_CHOICE:
        accounts = data.get("accounts") or []
        names = "、".join(str(a.get("nickname") or a.get("shopKey") or "") for a in accounts)
        raise BindingContextError(
            f"{platform} 有 {len(accounts)} 个可用账号，当前会话未绑定具体账号，"
            f"请让用户选择要使用哪一个：{names}",
            platform=platform,
            failure_kind=FAILURE_ACCOUNT_CHOICE,
            accounts=accounts,
        )

    if not data or not data.get("shop_key"):
        raise BindingContextError(
            f"{platform} 未绑定账号\n{hint}",
            platform=platform,
            failure_kind=FAILURE_NOT_BOUND,
        )

    session_hint = data.get("session_hint", "")
    if session_hint == "risk_control":
        raise BindingContextError(
            f"{platform} 会话被风控拦截，请在「账号连接」页面重新登录并完成验证。",
            platform=platform,
            failure_kind=FAILURE_RISK,
        )
    if session_hint == "expired":
        raise BindingContextError(
            f"{platform} 凭证已过期，请在「账号连接」页面重新登录。",
            platform=platform,
            failure_kind=FAILURE_TOKEN,
        )

    return data


def _platform_request(body: dict, *, platform: str, timeout: float = 30.0) -> dict:
    """通过网关代理发起平台请求"""
    body = {**body, "agent_id": runtime_http.require_agent_id(), "platform": platform}
    # 已选定账号：透传 shopKey，保证与 host 预检选到同一个号
    shop_key = runtime_http.optional_shop_key()
    if shop_key:
        body["shop_key"] = shop_key
    payload = runtime_http.post_json("/api/v1/proxy", body, timeout=max(timeout + 5.0, 15.0))

    if payload.get("status") == "success":
        return payload

    kind = payload.get("failure_kind", FAILURE_API)
    # rate_limit (如 FAIL_SYS_TOKEN_EXPIRED) 可重试，返回 payload 让调用方提取 set_cookies 等
    if kind == FAILURE_RATE:
        return payload

    msg = payload.get("error_message") or "平台请求失败"
    raise PlatformRequestError(
        msg,
        failure_kind=kind,
        status_code=payload.get("status_code", 0),
        accounts=payload.get("accounts") or [],
    )


def http_get(url: str, *, platform: str, params: dict | None = None,
             headers: dict | None = None, timeout: float = 30.0,
             inject_token: bool = True) -> dict:
    """通过网关代理发起 HTTP GET 请求"""
    body: dict[str, Any] = {
        "kind": "http_get",
        "url": url,
        "timeout": timeout,
        "inject_token": inject_token,
    }
    if params:
        body["params"] = params
    if headers:
        body["headers"] = headers
    return _platform_request(body, platform=platform, timeout=timeout)


def http_post(url: str, *, platform: str, json_body: dict | str | None = None,
              params: dict | None = None, headers: dict | None = None,
              timeout: float = 30.0,
              inject_token: bool = True) -> dict:
    """通过网关代理发起 HTTP POST 请求"""
    body: dict[str, Any] = {
        "kind": "http_post",
        "url": url,
        "timeout": timeout,
        "inject_token": inject_token,
    }
    if json_body is not None:
        body["json_body"] = json_body
    if params:
        body["params"] = params
    if headers:
        body["headers"] = headers
    return _platform_request(body, platform=platform, timeout=timeout)


def mtop_jsonp(url: str, *, platform: str, api: str, version: str = "1.0",
               data: str = "{}", extra_params: dict | None = None,
               timeout: float = 30.0,
               inject_token: bool = True) -> dict:
    """通过网关代理发起 mtop JSONP 请求（网关自动处理签名和 Cookie）"""
    body: dict[str, Any] = {
        "kind": "mtop_jsonp",
        "url": url,
        "api": api,
        "v": version,
        "data": data,
        "timeout": timeout,
        "inject_token": inject_token,
    }
    if extra_params:
        body["extra_params"] = extra_params
    return _platform_request(body, platform=platform, timeout=timeout)
