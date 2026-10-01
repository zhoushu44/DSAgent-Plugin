"""达摩盘 API 客户端 — 由 DeepSeek Agent workspace runtime 注入登录态。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from . import _runtime
from .config import DATASET_FIELD_ENDPOINT, ITEM_LIST_ENDPOINT
from .parse.common import response_data


class DmpStrategyClient:
    def __init__(self) -> None:
        self.client, self.shop_key = _runtime.get_dmp_client()
        self.common = {
            "bizCode": "dmp",
            "_tb_token_": self.client._tb_token,
            "_csrf": self.client._csrf_id,
            "csrfId": self.client._csrf_id,
        }

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.client.call_api(
            path,
            method="GET",
            params={**self.common, **(params or {})},
        )

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        return self.client.call_api(path, method="POST", params=self.common, body=body)

    def list_products(self, page: int, page_size: int, keyword: str = "") -> dict[str, Any]:
        payload = self.get(
            ITEM_LIST_ENDPOINT,
            {
                "lifeStageCodes": "",
                "keyword": keyword,
                "page": page,
                "pageSize": page_size,
                "orderIndicator": "",
                "orderType": "",
            },
        )
        return {
            "shop_key": self.shop_key,
            "page": page,
            "data": response_data(payload, "本店商品列表"),
        }

    def field(self, field_id: int) -> dict[str, Any]:
        raw = self.get(DATASET_FIELD_ENDPOINT, {"fieldId": field_id})
        value = response_data(raw, f"字段{field_id}")
        if not isinstance(value, dict):
            raise TypeError(f"字段{field_id}响应结构无效")
        return deepcopy(value)

    @staticmethod
    def with_values(field: dict[str, Any], values: list[Any]) -> dict[str, Any]:
        out = deepcopy(field)
        if "fieldId" not in out and out.get("id") is not None:
            out["fieldId"] = out["id"]
        out["values"] = values
        return out


def get_strategy_client() -> tuple[DmpStrategyClient, str]:
    client = DmpStrategyClient()
    return client, client.shop_key


__all__ = ["DmpStrategyClient", "get_strategy_client"]
