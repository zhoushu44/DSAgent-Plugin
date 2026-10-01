"""市场排行趋势分析 — CSV 导出"""

import csv
import logging
import os
from datetime import datetime

from .config import RANK_TYPE_CONFIGS, artifacts_dir
from .types import PeriodData, TrendItem

logger = logging.getLogger(__name__)


def _format_trend(trend: str) -> str:
    """趋势格式化"""
    mapping = {
        "up": "上升",
        "down": "下降",
        "stable": "持平",
        "new": "新上榜",
        "drop": "跌出榜",
    }
    return mapping.get(trend, trend)


def _format_rank_change(rank_change: int | None, trend: str) -> str:
    """排名变化格式化"""
    if rank_change is None or trend in ("new", "drop"):
        return "-"
    if rank_change == 0:
        return "0"
    if rank_change > 0:
        return f"↓{rank_change}"
    return f"↑{abs(rank_change)}"


def export_trend_csv(
    trend_items: list[TrendItem],
    periods: list[PeriodData],
    rank_type: str,
    trend_mode: str,
    cate_name: str = "",
) -> str:
    """导出趋势分析 CSV。

    Returns:
        文件绝对路径，失败返回空字符串
    """
    config = RANK_TYPE_CONFIGS[rank_type]
    period_unit = "月" if trend_mode == "month" else "周"

    # --- 构建表头 ---
    headers = [
        "当前排名",
        "趋势",
        "排名变化",
        "商品名称",
        "商品ID",
        "商品图片链接",
        "店铺名称",
        "店铺类型",
        "类目名称",
    ]

    # 4 个周期的排名列
    for i, period in enumerate(periods):
        label = period.date_label if trend_mode == "month" else f"第{i + 1}{period_unit}"
        headers.append(f"排名({label})")

    # 各指标的 4 周期列
    for metric in config["metrics"]:
        for i, period in enumerate(periods):
            label = period.date_label if trend_mode == "month" else f"第{i + 1}{period_unit}"
            headers.append(f"{metric['label']}({label})")

    # 商品关键词（仅部分榜单类型）
    if config["show_keywords"]:
        headers.append("商品关键词")

    # --- 构建数据行 ---
    rows: list[list[str]] = []
    for item in trend_items:
        row: list[str] = [
            str(item.current_rank) if item.current_rank else "-",
            _format_trend(item.trend),
            _format_rank_change(item.rank_change, item.trend),
            item.title,
            item.item_id,
            item.pict_url,
            item.shop_title,
            "天猫" if item.is_tmall else "淘宝",
            cate_name,
        ]

        # 4 周期排名
        for i in range(4):
            rank = item.ranks.get(f"period{i + 1}")
            row.append(str(rank) if rank is not None else "-")

        # 各指标
        for metric in config["metrics"]:
            for i in range(4):
                period_metrics = item.weekly_metrics.get(f"period{i + 1}", {})
                value = period_metrics.get(metric["field"], "-") or "-"
                row.append(str(value))

        if config["show_keywords"]:
            row.append(item.core_keyword or "-")

        rows.append(row)

    # --- 生成文件名 ---
    rank_label = config["label"]
    if periods:
        first_start = periods[0].date_range.split("|")[0].replace("-", "")
        last_end = periods[-1].date_range.split("|")[1].replace("-", "")
        date_str = f"{first_start}~{last_end}"
    else:
        date_str = datetime.now().strftime("%Y%m%d")

    filename = f"市场排行_趋势分析_{rank_label}_{date_str}_{datetime.now().strftime('%H%M%S')}.csv"
    out = artifacts_dir()
    filepath = str(out / filename)

    # --- 写入 CSV ---
    try:
        out.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(rows)
        logger.info(f"CSV 已导出: {filepath}")
        return filepath
    except OSError as e:
        logger.error(f"CSV 导出失败: {e}")
        return ""
