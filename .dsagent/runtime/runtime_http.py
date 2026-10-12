"""
DSAgent runtime HTTP 底层 — 读取环境变量、构造认证头、通用 JSON 请求。

技能脚本通过本地代理网关（gateway-proxy.ts）发 HTTP 请求，
Cookie 由网关从 CredentialStore 取并注入，技能侧不接触原始 Cookie。

环境变量（由 dsagent_execute_skill 工具注入）：
  DSCONNECT_URL      — 本地代理网关地址
  DSCONNECT_TOKEN    — 网关令牌（占位值 'local'，本地网关不验签）
  DSCONNECT_AGENT_ID — 当前会话（= 智能体）ID，网关据此走「会话绑定」这一级选号
  DSCONNECT_SHOP_KEY — 已选定账号的凭证库主键（可选），网关据此走「显式 shopKey」这一级，
                       保证 host 预检与网关选到同一个号
"""

from __future__ import annotations

import os
import json
import urllib.request
import urllib.error
from typing import Any


def api_base() -> str:
    """获取网关地址"""
    url = os.environ.get("DSCONNECT_URL", "")
    if not url:
        raise RuntimeError("DSCONNECT_URL 未设置，请确认技能由 DSAgent 插件启动")
    return url.rstrip("/")


def require_token() -> str:
    """获取网关令牌"""
    token = os.environ.get("DSCONNECT_TOKEN", "")
    if not token:
        raise RuntimeError("DSCONNECT_TOKEN 未设置")
    return token


def require_agent_id() -> str:
    """获取当前会话（= 智能体）ID"""
    aid = os.environ.get("DSCONNECT_AGENT_ID", "")
    if not aid:
        raise RuntimeError("DSCONNECT_AGENT_ID 未设置")
    return aid


def optional_shop_key() -> str:
    """获取已选定账号的凭证库主键；未选定（需用户选择）时返回空串"""
    return os.environ.get("DSCONNECT_SHOP_KEY", "").strip()


def auth_headers(*, content_json: bool = False) -> dict[str, str]:
    """构造认证请求头"""
    headers: dict[str, str] = {
        "Authorization": f"Bearer {require_token()}",
        "X-Agent-Id": require_agent_id(),
    }
    if content_json:
        headers["Content-Type"] = "application/json"
    return headers


def get_json(path: str, *, timeout: float = 15.0, params: dict | None = None) -> Any:
    """GET 请求到网关，返回 JSON"""
    from urllib.parse import urlencode

    base = api_base()
    url = f"{base}{path}"
    if params:
        url += "?" + urlencode(params)

    req = urllib.request.Request(url, method="GET")
    for k, v in auth_headers().items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        try:
            return json.loads(body)
        except Exception:
            raise RuntimeError(f"HTTP {e.code}: {body[:500]}")
    except Exception as e:
        raise RuntimeError(f"网关请求失败: {e}")


def post_json(path: str, body: Any, *, timeout: float = 15.0) -> Any:
    """POST 请求到网关，返回 JSON"""
    base = api_base()
    url = f"{base}{path}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")
    for k, v in auth_headers(content_json=True).items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        try:
            return json.loads(body)
        except Exception:
            raise RuntimeError(f"HTTP {e.code}: {body[:500]}")
    except Exception as e:
        raise RuntimeError(f"网关请求失败: {e}")
