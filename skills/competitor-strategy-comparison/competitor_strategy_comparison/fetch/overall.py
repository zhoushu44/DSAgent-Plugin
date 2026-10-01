"""本品/竞品同类目校验与核心经营指标取数。"""

from __future__ import annotations

import json
from typing import Any

from .._api_client import DmpStrategyClient
from ..cli_utils import date_text
from ..config import (
    COMPETITOR_LIST_ENDPOINT,
    DATASET_QUERY_ENDPOINT,
    ITEM_INFO_ENDPOINT,
    KEY_METRICS_DATASET_ID,
    LATEST_DAY_ENDPOINT,
    SELECTED_COMPETITOR_ENDPOINT,
)
from ..parse.common import exact_item, pick, preferred_value, response_data


def fetch_scope(
    client: DmpStrategyClient,
    *,
    own_id: str,
    competitor_id: str,
) -> dict[str, Any]:
    own = response_data(
        client.get(ITEM_INFO_ENDPOINT, {"scene": 1, "itemId": own_id}),
        "本品信息",
    )
    cate = preferred_value(own, "leafCateId", "leaf_cate_id", "leafCategoryId", "cateId")
    if not cate:
        raise RuntimeError("本品信息未返回叶子类目 ID")
    cate_id = str(cate)

    try:
        selected = response_data(
            client.get(SELECTED_COMPETITOR_ENDPOINT, {"itemId": own_id}),
            "已选竞品",
        )
    except Exception:  # noqa: BLE001 - 已选成功品是可选捷径，失败后仍须继续精确搜索
        selected = {}
    competitor = exact_item(selected, competitor_id)
    validation_source = "selected-success-item"

    if not competitor:
        latest = response_data(
            client.get(LATEST_DAY_ENDPOINT, {"sceneCode": "goodsGrowPathSuccItemList"}),
            "竞品最新数据日",
        )
        thedate = date_text(pick(latest, "latestDay", "thedate", "date", "latestDate") or latest) or ""
        params = {
            "cateId": cate_id,
            "itemId": own_id,
            "pageSize": 100,
            "page": 1,
            "keyword": competitor_id,
            "thedate": thedate,
        }
        found = response_data(
            client.get(COMPETITOR_LIST_ENDPOINT, params),
            "同类目竞品精确搜索",
        )
        competitor = exact_item(found, competitor_id)
        validation_source = "unfiltered-exact-search"

    if not competitor:
        raise RuntimeError(
            f"竞品 ID {competitor_id} 未在本品叶子类目 {cate_id} 的达摩盘可对比商品池中找到；"
            "该竞品可能与本品不属于同一叶子类目，请核对类目后重新提供竞品 ID"
        )

    competitor["dsagentValidationSource"] = validation_source
    return {
        "own_item": own,
        "competitor_item": competitor,
        "leaf_cate_id": cate_id,
    }


def build_filters(
    client: DmpStrategyClient,
    *,
    date_field_id: int,
    item_field_id: int,
    start: str,
    end: str,
    own_id: str,
    competitor_id: str,
) -> tuple[str, str]:
    date_field = client.field(date_field_id)
    item_field = client.field(item_field_id)
    own = [
        client.with_values(date_field, [start, end]),
        client.with_values(item_field, [int(own_id)]),
    ]
    competitor = [
        client.with_values(date_field, [start, end]),
        client.with_values(item_field, [str(competitor_id)]),
    ]
    return (
        json.dumps(own, ensure_ascii=False, separators=(",", ":")),
        json.dumps(competitor, ensure_ascii=False, separators=(",", ":")),
    )


def fetch_key_metrics(
    client: DmpStrategyClient,
    *,
    own_id: str,
    competitor_id: str,
    start: str,
    end: str,
) -> Any:
    base_filter, compare_filter = build_filters(
        client,
        date_field_id=6794,
        item_field_id=6797,
        start=start,
        end=end,
        own_id=own_id,
        competitor_id=competitor_id,
    )
    conf = {
        "columnList": [],
        "conditionList": [{"fieldId": 6794}, {"fieldId": 6797}],
        "indexList": [
            {"aggr": "SUM", "fieldId": 6813, "format": "", "fuzzy": "fineGrainedDataGeneralization"},
            {"aggr": "SUM", "fieldId": 8291, "format": None, "fuzzy": "fineGrainedDataGeneralization"},
            {"aggr": "SUM", "fieldId": 8290, "format": None, "fuzzy": "fineGrainedDataGeneralization"},
            {"aggr": "SUM", "fieldId": 6986, "format": None},
            {"aggr": "SUM", "fieldId": 6896, "format": "ROUND_OFF_1_PERCENT"},
            {"aggr": "SUM", "fieldId": 6895, "format": None},
            {"aggr": "SUM", "fieldId": 6897, "format": "ROUND_OFF_1_PERCENT"},
        ],
        "rowList": [],
        "userPageSize": 10,
    }
    chart_conf = {
        "alignType": "left",
        "displayType": "tile",
        "displayTotal": False,
        "mergeRowCell": False,
        "fuzzyConfig": {"base": False, "compare": True},
    }
    body = {
        "datasetId": KEY_METRICS_DATASET_ID,
        "chartConf": json.dumps(chart_conf),
        "conf": json.dumps(conf),
        "type": "INDEX_CARD",
        "_chartConfObj": chart_conf,
        "filterCondition": base_filter,
        "filterCompareCondition": compare_filter,
    }
    return response_data(client.post(DATASET_QUERY_ENDPOINT, body), "关键指标")


def fetch_overall(client: DmpStrategyClient, query: dict[str, Any]) -> dict[str, Any]:
    scope = fetch_scope(client, own_id=query["own_id"], competitor_id=query["competitor_id"])
    metrics = fetch_key_metrics(client, **query)
    return {**scope, "key_metrics": metrics}


__all__ = ["build_filters", "fetch_key_metrics", "fetch_overall", "fetch_scope"]
