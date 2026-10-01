"""人群经营数据解析。"""

from __future__ import annotations

from typing import Any

from .common import number_text


def audience_rows(data: Any) -> list[list[str]]:
    table = data.get("TABLE", {}) if isinstance(data, dict) else {}
    columns = table.get("columns") or []
    names: list[str] = []
    for column in columns:
        cells = column.get("cells") or []
        field = cells[0].get("field", {}) if cells else {}
        names.append(str(field.get("name") or ""))
    rows = table.get("rows") or []
    values = table.get("values") or []
    output: list[list[str]] = []
    for row, row_values in zip(rows, values):
        cells = row.get("cells") or []
        crowd = str(cells[0].get("value") if cells else "未知人群")
        metrics: dict[str, tuple[str, str]] = {}
        for name, value in zip(names, row_values):
            is_percent = name in {"支付转化率", "收加率"}
            metrics[name] = (
                number_text(value.get("value"), percent=is_percent),
                number_text(value.get("c_value"), percent=is_percent),
            )

        own_people, competitor_people = metrics.get("人群数", ("-", "-"))
        own_orders, competitor_orders = metrics.get("成交笔数", ("-", "-"))
        own_conversion, competitor_conversion = metrics.get("支付转化率", ("-", "-"))
        own_engagement, competitor_engagement = metrics.get("收加率", ("-", "-"))
        output.append([
            crowd,
            own_people,
            competitor_people,
            own_orders,
            competitor_orders,
            own_conversion,
            competitor_conversion,
            own_engagement,
            competitor_engagement,
        ])
    return output


def has_audience_data(data: Any) -> bool:
    return bool(audience_rows(data))
