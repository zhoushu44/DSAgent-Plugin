"""人群对比数据取数。"""

from __future__ import annotations

import json
from typing import Any

from .._api_client import DmpStrategyClient
from ..config import AUDIENCE_DATASET_ID, DATASET_QUERY_ENDPOINT
from ..parse.common import response_data
from .overall import build_filters


def fetch_audience(client: DmpStrategyClient, query: dict[str, Any]) -> Any:
    base_filter, compare_filter = build_filters(
        client,
        date_field_id=7463,
        item_field_id=7460,
        start=query["start"],
        end=query["end"],
        own_id=query["own_id"],
        competitor_id=query["competitor_id"],
    )
    conf = {
        "columnList": [],
        "conditionList": [{"fieldId": 7460}, {"fieldId": 7463}],
        "indexList": [
            {"aggr": "SUM", "fieldId": 7469, "fuzzy": "coarseGrainedDataGeneralization"},
            {"aggr": "SUM", "fieldId": 7468, "fuzzy": "fineGrainedDataGeneralization"},
            {"aggr": "SUM", "fieldId": 7465, "format": "ROUND_OFF_1_PERCENT", "fuzzy": "percentageGeneralization"},
            {"aggr": "SUM", "fieldId": 7464, "format": "ROUND_OFF_1_PERCENT", "fuzzy": "percentageGeneralization"},
        ],
        "rowList": [{"fieldId": 7459, "format": None}],
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
        "datasetId": AUDIENCE_DATASET_ID,
        "chartConf": json.dumps(chart_conf),
        "conf": json.dumps(conf),
        "type": "TABLE",
        "_chartConfObj": chart_conf,
        "filterCondition": base_filter,
        "filterCompareCondition": compare_filter,
    }
    return response_data(client.post(DATASET_QUERY_ENDPOINT, body), "人群对比")


__all__ = ["fetch_audience"]
