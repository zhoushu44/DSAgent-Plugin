"""关键词流量趋势数据抓取核心逻辑。"""

import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, Iterator, List

from .alimama_client import AlimamaInsightClient
from .config import (
    MODULE_CATEGORY_LIST,
    MODULE_MARKET_SUMMARY,
    MODULE_TREND_DATA,
)

logger = logging.getLogger(__name__)


def _iter_comp_ext(resp: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    """遍历 triggerDynamicModule 响应中的 compExt。"""
    inner = resp.get("data", {}).get("data", {})
    if not isinstance(inner, dict):
        return
    for slot in inner.get("compList", {}).values():
        ext = slot.get("compExt") or {}
        if ext:
            yield ext


class TrendFetcher:
    """关键词流量趋势数据获取器"""

    def __init__(self, client: AlimamaInsightClient):
        self._client = client

    def get_categories(self, keyword: str) -> List[Dict[str, Any]]:
        """获取关键词匹配的行业类目列表。

        Returns:
            [{"cate_id": 201272600, "cate_name": "3C数码配件 便携电源"}, ...]
        """
        resp = self._client.call_module(
            MODULE_CATEGORY_LIST,
            {
                "bizCode": "onebpSearch",
                "originalWordList": [keyword],
                "adgroupIds": "",
                "needGray": True,
            },
        )

        categories: List[Dict[str, Any]] = []
        for ext in _iter_comp_ext(resp):
            for item in ext.get("list", []):
                for cat in item.get("cateList", []):
                    cate_id = cat.get("cateId")
                    if cate_id is not None:
                        categories.append({
                            "cate_id": cate_id,
                            "cate_name": cat.get("cateName", ""),
                        })

        logger.info("关键词 [%s] 匹配到 %d 个类目", keyword, len(categories))
        return categories

    def fetch_trend(
        self,
        keyword: str,
        cate_id: int,
        months: int = 13,
    ) -> Dict[str, Any]:
        """获取关键词的趋势时间序列数据。

        Args:
            keyword: 关键词
            cate_id: 行业类目ID
            months: 月数（1~13，默认13）

        Returns:
            {"trend_data": [...], "date_range": "...", ...}
        """
        # 计算日期范围
        end_date = datetime.now() - timedelta(days=1)  # 昨天
        # 近似计算：每月30天
        start_date = end_date - timedelta(days=months * 30)

        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        logger.info(
            "查询趋势: keyword=%s, cate_id=%s, range=%s ~ %s",
            keyword, cate_id, start_str, end_str,
        )

        resp = self._client.call_module(
            MODULE_TREND_DATA,
            {
                "wordCategoryList": [{"word": keyword, "cateId": cate_id}],
                "startTime": start_str,
                "endTime": end_str,
                "isShowWordVs": 1,
                "isShowAdgroupVs": 0,
                "isShowShopVs": 0,
                "wordList": keyword,
                "strategyBidwordNameEqual": keyword,
                "vsName": "",
                "campaignAdgroupText": "&nbsp;",
                "needGray": True,
            },
        )

        # 解析响应数据
        trend_data = self._parse_trend_response(resp, keyword)

        return {
            "keyword": keyword,
            "cate_id": cate_id,
            "date_range": f"{start_str}|{end_str}",
            "months": months,
            "total_days": len(trend_data),
            "trend_data": trend_data,
        }

    def _parse_trend_response(
        self, resp: Dict[str, Any], keyword: str
    ) -> List[Dict[str, Any]]:
        """解析趋势 API 响应，提取每日数据点。

        API 返回的字段名包含关键词前缀（如 "充电宝impressionIndex"），
        需要动态去除前缀。
        """
        data = resp.get("data", {})
        trend_data = []

        # 实际响应结构: data.data.compList.{slotId}.compExt.chartGroup
        chart_groups: List[Dict[str, Any]] = []
        for ext in _iter_comp_ext(resp):
            cg = ext.get("chartGroup", [])
            if cg:
                chart_groups = cg
                break
        if not chart_groups:
            chart_groups = data.get("chartGroup", [])

        # chartGroup 是按指标分组的，每组包含 dataList
        # 我们需要将所有指标合并到按日期索引的字典中
        daily_map: Dict[str, Dict[str, Any]] = {}

        for group in chart_groups:
            data_list = group.get("data", []) or group.get("dataList", [])
            for point in data_list:
                date = point.get("theDate", "")
                if not date:
                    continue
                if date not in daily_map:
                    daily_map[date] = {"date": date}

                # 动态提取字段（去除关键词前缀）
                for key, value in point.items():
                    if key == "theDate":
                        continue
                    # 去除关键词前缀
                    field = key
                    if field.startswith(keyword):
                        field = field[len(keyword):]
                    # 标准化字段名
                    field_map = {
                        "impressionIndex": "impression_index",
                        "clickIndex": "click_index",
                        "ctr": "ctr",
                        "cvr": "cvr",
                        "competitionIndex": "competition_index",
                        "avgPrice": "avg_price",
                    }
                    std_field = field_map.get(field)
                    if std_field:
                        daily_map[date][std_field] = value

        # 按日期排序
        sorted_dates = sorted(daily_map.keys())
        trend_data = [daily_map[d] for d in sorted_dates]

        logger.info("解析到 %d 个数据点", len(trend_data))
        return trend_data

    def fetch_summary(
        self,
        keyword: str,
        cate_id: int,
        days: int = 30,
    ) -> Dict[str, Any]:
        """获取关键词的市场数据总结。

        Args:
            keyword: 关键词
            cate_id: 行业类目ID
            days: 统计天数（默认30）

        Returns:
            市场总结数据
        """
        end_date = datetime.now() - timedelta(days=1)
        start_date = end_date - timedelta(days=days - 1)

        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        resp = self._client.call_module(
            MODULE_MARKET_SUMMARY,
            {
                "originalWord": keyword,
                "categoryId": cate_id,
                "startTime": start_str,
                "endTime": end_str,
                "needGray": True,
            },
        )

        return self._parse_summary_response(resp, keyword)

    def _parse_summary_response(
        self, resp: Dict[str, Any], keyword: str
    ) -> Dict[str, Any]:
        """解析市场总结 API 响应。

        实际结构: data.data.compList 中各 slot 的 compExt 包含 title/content/tag。
        """
        data = resp.get("data", {})
        summary: Dict[str, Any] = {"keyword": keyword}

        # 从嵌套 compList 中提取所有卡片的 compExt
        cards: List[Dict[str, Any]] = []
        for ext in _iter_comp_ext(resp):
            if ext.get("title") or ext.get("contentTitle"):
                cards.append(ext)
            for col in ext.get("columns", []):
                for child in col.get("compList", []):
                    child_ext = child.get("compExt", {})
                    if child_ext.get("title"):
                        cards.append(child_ext)

        def strip_html(text: str) -> str:
            return re.sub(r"<[^>]+>", "", text) if text else ""

        for card in cards:
            title = card.get("title", "") or card.get("contentTitle", "")
            content = strip_html(card.get("content", ""))
            tag = card.get("tag", "")

            if "词的特性" in title:
                summary["keyword_trait"] = content
            elif "流量趋势" in title:
                summary["traffic_trend"] = content
                if tag:
                    summary["traffic_trend_tag"] = tag
            elif "竞争" in title:
                summary["competition"] = content
                if tag:
                    summary["competition_tag"] = tag
            elif "人群" in title:
                summary["audience"] = content
            elif "地域" in title:
                summary["geography"] = content
            elif "时间" in title:
                summary["time_pattern"] = content

        # 如果没有解析到结构化数据，保存原始响应
        if len(summary) <= 1:
            summary["raw_data"] = data

        return summary
