from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

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


SKU_HEADERS = [
    "商品序号",
    "商品ID",
    "商品标题",
    "店铺名称",
    "商品现价",
    "SKU_ID",
    "规格组合",
    "颜色",
    "尺码规格",
    "券前价",
    "券后价",
    "库存",
    "是否有货",
    "商品链接",
]


def export_sku_csv(rows: list[dict[str, Any]], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(SKU_HEADERS)
        for row in rows:
            writer.writerow([
                row.get("global_rank", ""),
                row.get("item_id", ""),
                row.get("item_title", ""),
                row.get("shop_name", ""),
                row.get("item_price", ""),
                row.get("sku_id", ""),
                row.get("specs", ""),
                row.get("color", ""),
                row.get("size", ""),
                row.get("price_before", ""),
                row.get("price_after", ""),
                row.get("stock", ""),
                row.get("in_stock", ""),
                row.get("product_link", ""),
            ])
    return str(output_path)
