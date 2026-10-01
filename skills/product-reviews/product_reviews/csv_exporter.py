from __future__ import annotations

import csv
from pathlib import Path

from .types import ReviewRecord

HEADERS = [
    "序号",
    "用户",
    "SKU名称",
    "标签",
    "初评时间",
    "晒图/视频",
    "评价内容",
    "追评内容",
    "追评晒图/视频",
    "有用",
]


def export_csv(reviews: list[ReviewRecord], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        for review in reviews:
            writer.writerow([
                review.index,
                review.user,
                review.sku_name,
                review.tags,
                review.feedback_date,
                review.media,
                review.feedback,
                review.append_feedback,
                review.append_media,
                review.like_count,
            ])
    return str(output_path)
