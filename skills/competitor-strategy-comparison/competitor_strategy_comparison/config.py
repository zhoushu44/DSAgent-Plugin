"""竞品策略对比 — 路径、接口与字段常量。"""

from __future__ import annotations

import sys
from pathlib import Path

from ._runtime import workspace_root

SYCM_PLATFORM = "sycm"
SCHEMA_VERSION = "dsagent/dmp-competitor-strategy/v2"

ITEM_LIST_ENDPOINT = "/api/goods/analysis/item/list"
ITEM_INFO_ENDPOINT = "/api/goods/item/info"
SELECTED_COMPETITOR_ENDPOINT = "/api/goods/grow/define/success/load"
COMPETITOR_LIST_ENDPOINT = "/api/goods/grow/define/success/item/list"
LATEST_DAY_ENDPOINT = "/api/latestDay"
DATASET_FIELD_ENDPOINT = "/dataplatform/dataset/getField.json"
DATASET_QUERY_ENDPOINT = "/dataplatform/dataset/report/query.json"
PROMOTION_SCENE_ENDPOINT = "/api/goods/grow/comparison/scene"
PROMOTION_KEYWORD_ENDPOINT = "/api/goods/grow/comparison/scene/keyword"

KEY_METRICS_DATASET_ID = 156
AUDIENCE_DATASET_ID = 175
FORCED_PROMOTION_SCENES = ("371", "372", "395", "435")

EXIT_SUCCESS = 0
EXIT_PARAM_ERROR = 1
EXIT_BINDING_ERROR = 2
EXIT_API_ERROR = 4


def artifacts_dir() -> Path:
    path = workspace_root() / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def print_output_files(**files: str) -> None:
    paths = {k: str(v) for k, v in files.items() if v}
    if not paths:
        return
    print("\n---[OUTPUT_FILES]", file=sys.stderr)
    for label, path in paths.items():
        print(f"{label}: {path}", file=sys.stderr)
