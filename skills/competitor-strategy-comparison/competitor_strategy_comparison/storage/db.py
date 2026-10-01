"""workspace artifacts 单轨存储。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import artifacts_dir


class AnalysisStorage:
    def artifact_paths(self, result: dict[str, Any]) -> tuple[Path, Path]:
        own_id = result["own_item"]["item_id"]
        competitor_id = result["competitor_item"]["item_id"]
        end = result["period"]["end_date"].replace("-", "")
        json_path = artifacts_dir() / f"dmp_competitor_strategy_{own_id}_{competitor_id}_{end}.json"
        return json_path, json_path.with_suffix(".md")

    def save(self, result: dict[str, Any]) -> tuple[Path, Path]:
        json_path, md_path = self.artifact_paths(result)
        json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return json_path, md_path

    def history(self, competitor_id: str = "", limit: int = 50) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        for path in sorted(artifacts_dir().glob("dmp_competitor_strategy_*.json"), reverse=True):
            if competitor_id and competitor_id not in path.name:
                continue
            rows.append({"artifact_path": str(path), "name": path.name})
            if len(rows) >= limit:
                break
        return rows
