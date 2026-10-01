from __future__ import annotations

from datetime import date, datetime, timedelta


def parse_date(value: str) -> date:
    text = str(value or "").strip()
    if not text:
        raise ValueError("日期不能为空")
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"日期格式无效: {value!r}，应为 YYYY-MM-DD")


def default_stat_date() -> date:
    return date.today() - timedelta(days=1)


def format_date(value: date) -> str:
    return value.strftime("%Y-%m-%d")


def format_date_compact(value: date) -> str:
    return value.strftime("%Y%m%d")


def build_day_range(day: date) -> str:
    text = format_date(day)
    return f"{text}|{text}"


def build_recent_range(*, end: date, days: int = 30) -> str:
    if days < 1:
        raise ValueError("days 必须 >= 1")
    start = end - timedelta(days=days - 1)
    return f"{format_date(start)}|{format_date(end)}"


def format_stat_date_ms(value: int | float | str | None) -> str:
    if value in (None, ""):
        return ""
    try:
        ts = int(float(value)) / 1000
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return str(value)
