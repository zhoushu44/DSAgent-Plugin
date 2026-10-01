"""关键词流量趋势 CSV 导出模块"""

import csv
import logging
import os
import re
from datetime import datetime

from .config import artifacts_dir

logger = logging.getLogger(__name__)

TREND_HEADERS = ["日期", "展现指数", "点击指数", "点击率", "点击转化率", "竞争指数", "市场均价"]


def export_trend_csv(
    trend_data: list[dict],
    keyword: str,
    cate_name: str = "",
    date_range: str = "",
) -> str:
    """将流量趋势数据导出为 CSV 文件。

    Returns:
        文件绝对路径，失败返回空字符串
    """
    if not trend_data:
        logger.warning("无趋势数据，跳过 CSV 导出")
        return ""

    if "|" in date_range:
        start_date, end_date = date_range.split("|")
    else:
        start_date = end_date = date_range or "unknown"

    safe_keyword = re.sub(r'[<>:"/\\|?*\'"]+', '', keyword)
    filename = f"关键词流量_{safe_keyword}_{start_date}至{end_date}_{datetime.now().strftime('%H%M%S')}.csv"

    out = artifacts_dir()
    out.mkdir(parents=True, exist_ok=True)
    filepath = os.path.join(str(out), filename)

    try:
        with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(TREND_HEADERS)
            for item in trend_data:
                writer.writerow([
                    item.get("date", ""),
                    item.get("impression_index", ""),
                    item.get("click_index", ""),
                    item.get("ctr", ""),
                    item.get("cvr", ""),
                    item.get("competition_index", ""),
                    item.get("avg_price", ""),
                ])
        logger.info(f"CSV 已导出: {filepath}")
        return filepath
    except OSError as e:
        logger.error(f"CSV 导出失败: {e}")
        return ""
