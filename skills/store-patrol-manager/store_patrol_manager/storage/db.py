"""轻量产物定位；不建立包含店铺历史的私有数据库。"""
from __future__ import annotations

from pathlib import Path

from .._runtime import workspace_root


class PatrolStorage:
    def __init__(self, workspace: str | Path = ".") -> None:
        del workspace
        self.workspace = workspace_root()
        self.artifacts = self.workspace / "artifacts"
        self.artifacts.mkdir(parents=True, exist_ok=True)

    def path(self, name: str) -> Path:
        return self.artifacts / name
