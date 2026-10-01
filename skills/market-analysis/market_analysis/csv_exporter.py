from __future__ import annotations

import csv
from pathlib import Path

from .types import SearchProduct

HEADERS = [
    "序号",
    "页码",
    "页内排名",
    "商品ID",
    "标题",
    "现价",
    "原价",
    "销量文本",
    "销量数值",
    "同款数",
    "店铺名称",
    "店铺标题",
    "所在地",
    "是否天猫",
    "活动标签",
    "类目ID",
    "商品链接",
    "主图",
]


def export_csv(products: list[SearchProduct], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        for product in products:
            writer.writerow([
                product.global_rank,
                product.page,
                product.page_rank,
                product.item_id,
                product.title,
                product.current_price,
                product.original_price,
                product.sales,
                product.sales_count,
                product.same_count,
                product.shop_name,
                product.shop_title,
                product.location,
                "是" if product.is_tmall else "否",
                product.activity_tag,
                product.category_id,
                product.product_link,
                product.main_image,
            ])
    return str(output_path)
