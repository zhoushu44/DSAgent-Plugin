"""CSV 原始数据导出模块"""

import csv
import logging
import os
from datetime import datetime

from .config import artifacts_dir
from .types import HotRankResult, KeywordResult

logger = logging.getLogger(__name__)

EXPAND_HEADERS = [
    "排名", "拓展词", "搜索人气", "搜索人气环比", "点击率", "点击率环比",
    "免费点击率", "支付买家数", "支付转化率", "需求供给比", "天猫商品点击率",
]

RANK_HEADERS = [
    "排名", "搜索词", "搜索人气", "支付转化率", "点击率", "免费点击率",
]


def export_csv(
    all_results: dict[str, list[KeywordResult]],
    date_range: str,
) -> str:
    start_date, end_date = date_range.split("|") if "|" in date_range else (date_range, date_range)
    seeds_str = "_".join(list(all_results.keys())[:3])
    if len(all_results) > 3:
        seeds_str += f"等{len(all_results)}词"
    filename = f"关键词数据_{seeds_str}_{start_date}至{end_date}_{datetime.now().strftime('%H%M%S')}.csv"
    out = artifacts_dir()
    filepath = str(out / filename)

    try:
        out.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["种子词"] + EXPAND_HEADERS)
            for seed_keyword, results in all_results.items():
                for idx, item in enumerate(results, start=1):
                    writer.writerow([
                        seed_keyword,
                        idx,
                        item.related_keyword,
                        item.search_popularity,
                        item.search_popularity_change,
                        item.click_rate,
                        item.click_rate_change,
                        item.free_click_rate,
                        item.pay_buyer_cnt,
                        item.pay_conv_rate,
                        item.demand_supply_ratio,
                        item.tmall_click_ratio,
                    ])
        logger.info(f"CSV 已导出: {filepath}")
        return filepath
    except OSError as e:
        logger.error(f"CSV 导出失败: {e}")
        return ""


def export_rank_csv(
    results: list[HotRankResult],
    date_range: str,
    rank_type: str = "hot",
    kw_type: str = "search",
) -> str:
    rank_type_names = {"hot": "热搜", "rise": "飙升", "new": "新词"}
    start_date, end_date = date_range.split("|") if "|" in date_range else (date_range, date_range)
    filename = f"搜索排行_{rank_type_names.get(rank_type, rank_type)}_{kw_type}_{start_date}至{end_date}_{datetime.now().strftime('%H%M%S')}.csv"
    out = artifacts_dir()
    filepath = str(out / filename)

    try:
        out.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(RANK_HEADERS)
            for item in results:
                writer.writerow([
                    item.rank,
                    item.keyword,
                    item.search_popularity,
                    item.pay_rate,
                    item.click_rate,
                    item.free_click_rate,
                ])
        logger.info(f"CSV 已导出: {filepath}")
        return filepath
    except OSError as e:
        logger.error(f"CSV 导出失败: {e}")
        return ""
