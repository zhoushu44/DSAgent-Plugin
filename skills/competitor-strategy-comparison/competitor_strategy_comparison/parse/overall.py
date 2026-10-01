"""核心经营指标解析与业务字段改名。"""

from __future__ import annotations

from typing import Any

from .common import number_text


def metric_rows(data: Any) -> list[list[str]]:
    card = data.get("INDEX_CARD", {}) if isinstance(data, dict) else {}
    fields = card.get("fields") or []
    values = card.get("values") or []
    percent_names = {"支付转化率", "加购率"}
    money_names = {"笔单价"}
    display_names = {
        "IPV": "浏览量",
        "IPv": "浏览量",
        "营销推广点击量": "付费点击量",
        "自然点击量": "免费点击量",
        "成交笔数": "成交订单数",
        "笔单价": "单价",
    }
    rows: list[list[str]] = []
    values_by_name: dict[str, dict[str, Any]] = {}
    for field, value in zip(fields, values):
        name = str(field.get("name") or "未命名指标")
        values_by_name[name] = value
        rows.append([
            display_names.get(name, name),
            number_text(value.get("value"), percent=name in percent_names, money=name in money_names),
            number_text(value.get("c_value"), percent=name in percent_names, money=name in money_names),
            str(value.get("diff_value") or "-"),
        ])

    orders = values_by_name.get("成交笔数") or {}
    unit_price = values_by_name.get("笔单价") or {}

    def amount(side: str) -> float | None:
        try:
            return float(orders.get(side)) * float(unit_price.get(side))
        except (TypeError, ValueError):
            return None

    own_amount = amount("value")
    competitor_amount = amount("c_value")
    diff = "-"
    if own_amount is not None and competitor_amount not in (None, 0):
        diff = f"{(own_amount / competitor_amount - 1) * 100:+.1f}%"
    amount_row = [
        "成交金额",
        number_text(own_amount, money=True) if own_amount is not None else "本周期无法计算",
        number_text(competitor_amount, money=True) if competitor_amount is not None else "本周期无法计算",
        diff,
    ]
    insert_at = next((i for i, row in enumerate(rows) if row[0] == "加购率"), len(rows))
    rows.insert(insert_at, amount_row)
    return rows


def has_overall_data(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    card = data.get("INDEX_CARD") or {}
    return bool(card.get("fields") and card.get("values"))
