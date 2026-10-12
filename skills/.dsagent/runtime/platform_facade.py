"""
DSAgent runtime 平台门面 — 平台专属客户端类 + 工厂函数。

技能的 _api_client.py 通过 _runtime.py 的 __getattr__ 从此处获取：
  - SycmClient / get_sycm_client       (生意参谋)
  - AlimamaInsightClient / get_alimama_client  (万相台)
  - MtopCaller                          (淘宝 mtop)
  - DmpCompetitionClient / get_dmp_client     (达摩盘)
  - WorkspaceCache                     (技能缓存)
  - get_taobao_shop_key                (淘宝店铺)
  - 各平台专属错误类型

所有平台请求最终走 platform_client.http_get/http_post/mtop_jsonp → 网关代理。
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from . import platform_client
    from . import runtime_http
except ImportError:
    import platform_client
    import runtime_http


# ═══════════════════════════════════════════════════════════════
# 生意参谋 (SYCM) 客户端
# ═══════════════════════════════════════════════════════════════

class SycmApiError(Exception):
    """生意参谋 API 通用错误"""
    def __init__(self, message: str, *, failure_kind: str = platform_client.FAILURE_API):
        super().__init__(message)
        self.message = message
        self.failure_kind = failure_kind


class SycmRequestError(SycmApiError):
    """生意参谋请求错误"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind=platform_client.FAILURE_API)


class ApiPermissionError(SycmApiError):
    """生意参谋权限不足"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind="permission_denied")


class ApiSessionExpiredError(SycmApiError):
    """生意参谋会话过期"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind=platform_client.FAILURE_TOKEN)


class SycmClient:
    """生意参谋 API 客户端 — 通过网关代理发 GET 请求"""

    # 健康检查端点（类目树，所有 sycm 账号均可访问）
    _HEALTH_CHECK_URL = "https://sycm.taobao.com/cc/common/category/getStdCate.json"

    def health_check(self) -> None:
        """验证 sycm API URL 可达性。如果返回 404/5xx 则抛出 SycmApiError。

        在技能首次调用前使用，提前发现 URL 错误，避免被误判为风控。
        """
        try:
            self.get(self._HEALTH_CHECK_URL, {"level": "1"})
        except ApiSessionExpiredError:
            pass  # 登录态问题不阻碍 URL 验证
        except ApiPermissionError:
            pass  # 风控不阻碍 URL 验证
        except SycmApiError as e:
            raise SycmApiError(
                f"生意参谋 API URL 不可达（{e}）。"
                f"请检查 config.py 中的 SYCM_BASE_URL 是否正确，"
                f"或参考 SKILL.md「API 接口」章节确认端点。"
            ) from e
        except SycmRequestError as e:
            raise SycmApiError(
                f"生意参谋 API 请求失败（{e}）。"
                f"请检查 config.py 中的 SYCM_BASE_URL 是否正确。"
            ) from e

    def get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            resp = platform_client.http_get(
                url, platform="sycm", params=params, timeout=30.0
            )
        except platform_client.PlatformRequestError as e:
            if e.failure_kind == platform_client.FAILURE_TOKEN:
                raise ApiSessionExpiredError(str(e))
            if e.failure_kind == platform_client.FAILURE_RISK:
                raise ApiPermissionError(f"风控拦截: {e}")
            raise SycmRequestError(str(e))

        body = resp.get("payload")
        if isinstance(body, str):
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                raise SycmApiError(f"响应解析失败: {body[:200]}")
        if isinstance(body, dict):
            return body
        raise SycmApiError(f"意外响应类型: {type(body)}")


def get_sycm_client() -> tuple["SycmClient", str]:
    """获取生意参谋客户端 + shop_key"""
    ctx = platform_client.fetch_binding_context(platform="sycm")
    shop_key = ctx.get("shop_key", "")
    return SycmClient(), shop_key


# ═══════════════════════════════════════════════════════════════
# 万相台 (Alimama) 客户端
# ═══════════════════════════════════════════════════════════════

class AlimamaError(Exception):
    """万相台 API 通用错误"""
    def __init__(self, message: str, *, failure_kind: str = platform_client.FAILURE_API):
        super().__init__(message)
        self.message = message
        self.failure_kind = failure_kind
        self.details = {}


class AlimamaRateLimitError(AlimamaError):
    """万相台限流"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind=platform_client.FAILURE_RATE)


class AuthInfo:
    """万相台认证信息"""
    def __init__(self, **kwargs: Any):
        for k, v in kwargs.items():
            setattr(self, k, v)


class AlimamaInsightClient:
    """万相台洞察客户端 — 通过网关代理调用 alimama API"""

    # 健康检查 URL（triggerDynamicModule 端点本身，用空 body 验证可达性）
    _HEALTH_CHECK_URL = "https://one.alimama.com/cube/triggerDynamicModule.json"

    def __init__(self, csrf_id: str = "", login_point_id: str = ""):
        self.csrf_id = csrf_id
        self.login_point_id = login_point_id

    def health_check(self) -> None:
        """验证万相台 API URL 可达性。如果返回 404/5xx 则抛出 AlimamaError。

        在技能首次调用前使用，提前发现 URL 错误，避免被误判为风控。
        """
        try:
            self.call_module(0, {})
        except AlimamaRateLimitError:
            pass  # 限流说明 URL 正确
        except AlimamaError as e:
            msg = str(e)
            if "404" in msg or "Not Found" in msg or "api_error" in msg:
                raise AlimamaError(
                    f"万相台 API URL 不可达（{e}）。"
                    f"请检查 call_module() 中的 URL 是否为 "
                    f"https://one.alimama.com/cube/triggerDynamicModule.json，"
                    f"参考 SKILL.md「API 接口」章节确认端点。"
                ) from e
            # 其他错误（如 csrf 无效）说明 URL 正确，只是认证问题 — 不阻断

    def call_module(self, module_id: int, params: dict[str, Any]) -> dict[str, Any]:
        """调用万相台 triggerDynamicModule 接口。

        Args:
            module_id: moduleId（如 1541=趋势, 1571=类目, 1465=总结）
            params: 模块参数（wordCategoryList / originalWord 等）
        """
        # ★ 改 URL 前先看 skills/keyword-traffic/SKILL.md「API 接口」章节
        url = "https://one.alimama.com/cube/triggerDynamicModule.json"

        # query params: csrfId + bizCode
        query_params: dict[str, Any] = {}
        if self.csrf_id:
            query_params["csrfId"] = self.csrf_id
            query_params["bizCode"] = "universalBP"

        # body: { moduleId, params, csrfId, bizCode, loginPointId }
        body: dict[str, Any] = {
            "moduleId": module_id,
            "params": params,
        }
        if self.csrf_id:
            body["csrfId"] = self.csrf_id
            body["bizCode"] = "universalBP"
        if self.login_point_id:
            body["loginPointId"] = self.login_point_id

        try:
            resp = platform_client.http_post(
                url,
                platform="alimama",
                json_body=body,
                params=query_params,
                headers={
                    "Content-Type": "application/json;charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": "https://one.alimama.com",
                    "Referer": "https://one.alimama.com/index.html",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                },
                timeout=30.0,
            )
        except platform_client.PlatformRequestError as e:
            if e.failure_kind == platform_client.FAILURE_RATE:
                raise AlimamaRateLimitError(str(e))
            raise AlimamaError(str(e))

        resp_body = resp.get("payload")
        if isinstance(resp_body, str):
            try:
                return json.loads(resp_body)
            except json.JSONDecodeError:
                raise AlimamaError(f"响应解析失败: {resp_body[:200]}")
        if isinstance(resp_body, dict):
            return resp_body
        raise AlimamaError(f"意外响应类型: {type(resp_body)}")


def get_alimama_client() -> tuple["AlimamaInsightClient", str]:
    """获取万相台客户端 + shop_key"""
    ctx = platform_client.fetch_binding_context(platform="alimama")
    shop_key = ctx.get("shop_key", "")
    csrf_id = ctx.get("alimama_csrf_id", "") or ""
    login_point_id = ctx.get("alimama_login_point_id", "") or ""
    client = AlimamaInsightClient(csrf_id=csrf_id, login_point_id=login_point_id)
    return client, shop_key


# ═══════════════════════════════════════════════════════════════
# 淘宝 Mtop 客户端
# ═══════════════════════════════════════════════════════════════

class TaobaoRequestError(Exception):
    """淘宝请求错误"""
    def __init__(self, message: str, *, failure_kind: str = platform_client.FAILURE_API):
        super().__init__(message)
        self.message = message
        self.failure_kind = failure_kind


class TaobaoRateLimitError(TaobaoRequestError):
    """淘宝限流"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind=platform_client.FAILURE_RATE)


class TaobaoRiskControlError(TaobaoRequestError):
    """淘宝风控"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind=platform_client.FAILURE_RISK)


class TaobaoSessionExpiredError(TaobaoRequestError):
    """淘宝会话过期"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind=platform_client.FAILURE_TOKEN)


def _mtop_error_from(exc: platform_client.PlatformRequestError) -> TaobaoRequestError:
    if exc.failure_kind == platform_client.FAILURE_RATE:
        return TaobaoRateLimitError(str(exc))
    if exc.failure_kind == platform_client.FAILURE_RISK:
        return TaobaoRiskControlError(str(exc))
    if exc.failure_kind == platform_client.FAILURE_TOKEN:
        return TaobaoSessionExpiredError(str(exc))
    return TaobaoRequestError(str(exc))


class MtopCaller:
    """淘宝 mtop API 调用器 — 通过网关代理发 mtop JSONP 请求"""

    def __init__(
        self,
        *,
        interval_seconds: float = 2.0,
        interval_jitter_seconds: float = 0.5,
        max_attempts: int = 3,
        backoff_seconds: float = 1.0,
    ):
        self._min_interval = interval_seconds
        self._jitter = interval_jitter_seconds
        self._max_attempts = max_attempts
        self._backoff = backoff_seconds
        self._last_call = 0.0

    def _throttle(self) -> None:
        now = time.time()
        elapsed = now - self._last_call
        if elapsed < self._min_interval:
            wait = self._min_interval - elapsed
            if self._jitter > 0:
                wait += random.uniform(0, self._jitter)
            time.sleep(wait)
        self._last_call = time.time()

    def call(
        self,
        *,
        label: str,
        url: str,
        api: str,
        version: str,
        data: str,
        headers: dict[str, str] | None = None,
        extra_params: dict[str, Any] | None = None,
        timeout: float = 30.0,
        app_key: str = "",
    ) -> dict[str, Any]:
        last_error: TaobaoRequestError | None = None
        for attempt in range(self._max_attempts + 1):
            try:
                return self._do_call(
                    url=url, api=api, version=version, data=data,
                    headers=headers, extra_params=extra_params,
                    timeout=timeout, app_key=app_key,
                )
            except TaobaoRateLimitError as e:
                last_error = e
                if attempt < self._max_attempts:
                    delay = min(self._backoff * (2 ** attempt) + random.uniform(0, 1), 30.0)
                    time.sleep(delay)
                    continue
                raise
            except (TaobaoRiskControlError, TaobaoSessionExpiredError):
                raise
            except TaobaoRequestError as e:
                last_error = e
                if attempt < self._max_attempts:
                    delay = min(self._backoff * (2 ** attempt) + random.uniform(0, 1), 30.0)
                    time.sleep(delay)
                    continue
                raise
        if last_error:
            raise last_error

    def call_once(
        self,
        *,
        label: str,
        url: str,
        api: str,
        version: str,
        data: str,
        headers: dict[str, str] | None = None,
        extra_params: dict[str, Any] | None = None,
        timeout: float = 30.0,
        app_key: str = "",
    ) -> dict[str, Any]:
        return self._do_call(
            url=url, api=api, version=version, data=data,
            headers=headers, extra_params=extra_params,
            timeout=timeout, app_key=app_key,
        )

    def _do_call(
        self,
        *,
        url: str,
        api: str,
        version: str,
        data: str,
        headers: dict[str, str] | None,
        extra_params: dict[str, Any] | None,
        timeout: float,
        app_key: str,
    ) -> dict[str, Any]:
        self._throttle()
        try:
            resp = platform_client.mtop_jsonp(
                url,
                platform="taobao",
                api=api,
                version=version,
                data=data,
                extra_params=extra_params,
                timeout=timeout,
            )
        except platform_client.PlatformRequestError as e:
            raise _mtop_error_from(e)

        body = resp.get("payload")
        if isinstance(body, str):
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                raise TaobaoRequestError(f"mtop 响应解析失败: {body[:200]}")
        if isinstance(body, dict):
            return body
        raise TaobaoRequestError(f"意外响应类型: {type(body)}")


# ═══════════════════════════════════════════════════════════════
# 达摩盘 (DMP) 客户端
# ═══════════════════════════════════════════════════════════════

class DmpError(Exception):
    """达摩盘 API 通用错误"""
    def __init__(self, message: str, *, failure_kind: str = platform_client.FAILURE_API):
        super().__init__(message)
        self.message = message
        self.failure_kind = failure_kind


class DmpRateLimitError(DmpError):
    """达摩盘限流"""
    def __init__(self, message: str):
        super().__init__(message, failure_kind=platform_client.FAILURE_RATE)


class DmpCompetitionClient:
    """达摩盘竞品客户端 — 通过网关代理调用 dmp API"""

    # 健康检查端点（GET 公共参数即可验证可达性）
    _HEALTH_CHECK_ENDPOINT = "/api/competition/getCompetitors.json"

    def __init__(self, *, tb_token: str = "", csrf_id: str = ""):
        self._tb_token = tb_token
        self._csrf_id = csrf_id

    def health_check(self) -> None:
        """验证达摩盘 API URL 可达性。如果返回 404/5xx 则抛出 DmpError。

        在技能首次调用前使用，提前发现 URL 错误，避免被误判为风控。
        """
        try:
            self.call_api(
                self._HEALTH_CHECK_ENDPOINT,
                method="GET",
                params=self._common_params(),
            )
        except DmpRateLimitError:
            pass  # 限流说明 URL 正确
        except DmpError as e:
            msg = str(e)
            if "404" in msg or "Not Found" in msg or "api_error" in msg:
                raise DmpError(
                    f"达摩盘 API URL 不可达（{e}）。"
                    f"请检查 call_api() 中的 base URL 是否为 "
                    f"https://dmp.advgateway.taobao.com，"
                    f"参考 SKILL.md「API 接口」章节确认端点。"
                ) from e
            # 其他错误说明 URL 正确，只是认证/权限问题 — 不阻断

    def _common_params(self) -> dict[str, Any]:
        """构造公共查询参数（bizCode + _tb_token_ + _csrf + csrfId）"""
        return {
            "bizCode": "dmp",
            "_tb_token_": self._tb_token,
            "_csrf": self._csrf_id,
            "csrfId": self._csrf_id,
        }

    def indicator_query(
        self,
        *,
        competitor_ids: list[int],
        entity_id: int,
        begin_date: str,
        end_date: str,
        peer_begin_date: str,
        peer_end_date: str,
        competition_type: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """构造竞品指标查询参数和请求体"""
        params = self._common_params()
        body: dict[str, Any] = {
            "competitorIds": ",".join(str(c) for c in competitor_ids),
            "entityId": entity_id,
            "beginDate": begin_date,
            "endDate": end_date,
            "peerBeginDate": peer_begin_date,
            "peerEndDate": peer_end_date,
            "competitionType": competition_type,
        }
        return params, body

    def call_api(
        self,
        endpoint: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        method: str = "POST",
    ) -> dict[str, Any]:
        """调用 dmp API"""
        # ★ 改 URL 前先看 skills/competitor-indicator/SKILL.md「API 接口」章节
        base = "https://dmp.advgateway.taobao.com"
        url = f"{base}{endpoint}"
        try:
            if method.upper() == "GET":
                resp = platform_client.http_get(
                    url, platform="dmp", params=params, timeout=30.0
                )
            else:
                resp = platform_client.http_post(
                    url, platform="dmp", json_body=body, params=params,
                    headers={"Content-Type": "application/json;charset=UTF-8",
                             "X-Requested-With": "XMLHttpRequest",
                             "Accept": "application/json, text/javascript, */*; q=0.01"},
                    timeout=30.0,
                )
        except platform_client.PlatformRequestError as e:
            if e.failure_kind == platform_client.FAILURE_RATE:
                raise DmpRateLimitError(str(e))
            raise DmpError(str(e))

        response_body = resp.get("payload")
        if isinstance(response_body, str):
            try:
                return json.loads(response_body)
            except json.JSONDecodeError:
                raise DmpError(f"响应解析失败: {response_body[:200]}")
        if isinstance(response_body, dict):
            return response_body
        raise DmpError(f"意外响应类型: {type(response_body)}")

    def insight_query_params(self, *, module_instance_id: int) -> dict[str, Any]:
        """构造洞察查询参数"""
        params = self._common_params()
        params["moduleInstanceId"] = module_instance_id
        return params


def get_dmp_client() -> tuple["DmpCompetitionClient", str]:
    """获取达摩盘客户端 + shop_key"""
    ctx = platform_client.fetch_binding_context(platform="dmp")
    shop_key = ctx.get("shop_key", "")
    tb_token = ctx.get("tb_token", "")
    csrf_id = ctx.get("alimama_csrf_id", "") or ""
    return DmpCompetitionClient(tb_token=tb_token, csrf_id=csrf_id), shop_key


# ═══════════════════════════════════════════════════════════════
# 淘宝店铺 shop_key
# ═══════════════════════════════════════════════════════════════

def get_taobao_shop_key() -> str:
    """获取淘宝店铺 shop_key"""
    ctx = platform_client.fetch_binding_context(platform="taobao")
    return ctx.get("shop_key", "")


# ═══════════════════════════════════════════════════════════════
# 技能缓存 (WorkspaceCache)
# ═══════════════════════════════════════════════════════════════

def _cache_db_path(shop_key: str, skill_slug: str, platform: str) -> Path:
    """缓存数据库路径"""
    workspace = os.environ.get("DSAGENT_WORKSPACE", os.getcwd())
    cache_dir = Path(workspace) / ".dsagent" / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    safe_key = (shop_key or "default").replace("/", "_").replace("\\", "_")
    return cache_dir / f"{platform}_{skill_slug}_{safe_key}.db"


class WorkspaceCache:
    """技能级 SQLite 缓存"""

    def __init__(self, *, shop_key: str, skill_slug: str, platform: str):
        self.shop_key = shop_key
        self._skill_slug = skill_slug
        self._platform = platform
        db_path = _cache_db_path(shop_key, skill_slug, platform)
        self._conn = sqlite3.connect(str(db_path))
        self._conn.row_factory = sqlite3.Row

    def execute_schema(self, sql: str) -> None:
        """执行多语句 DDL"""
        self._conn.executescript(sql)
        self._conn.commit()

    def execute(self, sql: str, params: tuple = ()) -> None:
        self._conn.execute(sql, params)
        self._conn.commit()

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        self._conn.executemany(sql, rows)
        self._conn.commit()

    def query_one(self, sql: str, params: tuple = ()) -> dict[str, Any] | None:
        cur = self._conn.execute(sql, params)
        row = cur.fetchone()
        if row is None:
            return None
        return dict(row)

    def query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        cur = self._conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]

    def now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def close(self) -> None:
        self._conn.close()
