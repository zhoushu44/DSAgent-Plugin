"""检查本次运行的原始 JSON 路径，不读取整包到模型上下文。"""
from __future__ import annotations

from pathlib import Path


def collect_raw_inputs(values: list[str] | None) -> list[str]:
    result: list[str] = []
    for value in values or []:
        path = Path(value)
        if path.is_dir():
            result.extend(str(p) for p in sorted(path.glob("*.json")))
        elif path.is_file():
            result.append(str(path))
        else:
            raise FileNotFoundError(f"找不到原始数据：{path}")
    return result

