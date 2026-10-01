from __future__ import annotations

import math
import re
from collections import Counter
from statistics import median
from typing import Any, Iterable, Sequence

from .types import SearchProduct

TITLE_SPLIT_RE = re.compile(r"[^0-9a-zA-Z\u4e00-\u9fff]+")
CHINESE_CHUNK_RE = re.compile(r"[\u4e00-\u9fff]{2,}")
ALNUM_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")

TITLE_TERM_STOPWORDS = {
    "官方",
    "正品",
    "包邮",
    "现货",
    "全新",
    "新品",
    "新款",
    "同款",
}

GENERIC_FRONT_TERM_STOPWORDS = {
    "饮料",
    "饮品",
    "茶饮",
    "茶饮料",
    "商品",
    "店铺",
    "专用",
    "商用",
    "优惠",
    "惠券",
    "优惠券",
}

SALES_BUCKETS = [
    (0, 99, "0-99"),
    (100, 499, "100-499"),
    (500, 999, "500-999"),
    (1000, 4999, "1000-4999"),
    (5000, 9999, "5000-9999"),
    (10000, None, "10000+"),
]

TRAIT_SUMMARY_LABEL_MAP = {
    "shop_type": "{label}店铺",
    "price_bucket": "到手价在{label}的商品",
    "original_price_bucket": "原价在{label}的商品",
    "coupon_bucket": "优惠金额在{label}的商品",
    "activity_tag": "带“{label}”活动标签的商品",
    "location_province": "{label}发货商品",
    "location": "{label}发货商品",
    "activity_flag": "带活动标签的商品",
    "p4p_flag": "推广商品",
}

TRAIT_TYPE_PRIORITY = {
    "price_bucket": 0,
    "original_price_bucket": 1,
    "coupon_bucket": 2,
    "location_province": 3,
    "location": 4,
    "activity_tag": 5,
    "shop_type": 6,
    "activity_flag": 7,
    "p4p_flag": 8,
}

TRAIT_TYPE_MAX_ITEMS = {
    "price_bucket": 1,
    "original_price_bucket": 1,
    "coupon_bucket": 1,
    "location_province": 1,
    "location": 1,
    "activity_tag": 1,
    "shop_type": 1,
    "activity_flag": 1,
    "p4p_flag": 1,
}

TRAIT_TYPE_GROUP_MAP = {
    "location_province": "location",
    "location": "location",
}

TRAIT_SELECTION_RULES = {
    "price_bucket": {"min_front_count": 6, "min_front_coverage": 0.12, "min_delta": 0.02},
    "original_price_bucket": {"min_front_count": 6, "min_front_coverage": 0.12, "min_delta": 0.02},
    "coupon_bucket": {"min_front_count": 5, "min_front_coverage": 0.1, "min_delta": 0.02},
    "location_province": {"min_front_count": 5, "min_front_coverage": 0.12, "min_delta": 0.02},
    "location": {"min_front_count": 5, "min_front_coverage": 0.1, "min_delta": 0.025},
    "activity_tag": {"min_front_count": 3, "min_front_coverage": 0.08, "min_delta": 0.02},
    "shop_type": {"min_front_count": 10, "min_front_coverage": 0.5, "min_delta": 0.05},
    "activity_flag": {"min_front_count": 8, "min_front_coverage": 0.25, "min_delta": 0.03},
    "p4p_flag": {"min_front_count": 4, "min_front_coverage": 0.08, "min_delta": 0.03},
}


def build_market_analysis(
    keyword: str,
    products: Sequence[SearchProduct],
    *,
    total_count: int,
    collected_pages: int,
) -> dict[str, Any]:
    sample_size = len(products)
    front_sample_size = _resolve_front_sample_size(sample_size)
    overview = _build_overview(
        products,
        total_count=total_count,
        collected_pages=collected_pages,
        front_sample_size=front_sample_size,
    )

    if not products:
        return {
            "overview": overview,
            "high_frequency_terms": [],
            "front_rank_terms": [],
            "shared_traits": [],
            "distributions": _empty_distributions(),
            "insights": ["当前没有抓到商品数据，无法生成高频词和排名共性分析。"],
        }

    title_term_sets = [_extract_title_terms(product.title, keyword) for product in products]
    overall_term_counter = Counter()
    front_term_counter = Counter()
    for index, term_set in enumerate(title_term_sets):
        overall_term_counter.update(term_set)
        if index < front_sample_size:
            front_term_counter.update(term_set)

    high_frequency_terms = _select_high_frequency_terms(overall_term_counter, sample_size)
    front_rank_terms = _select_front_rank_terms(
        overall_term_counter,
        front_term_counter,
        sample_size,
        front_sample_size,
    )
    shared_traits = _build_shared_traits(products, front_sample_size)
    front_rank_summary_lines = _build_front_rank_summary_lines(
        front_rank_terms,
        front_sample_size,
    )
    shared_trait_summary_lines = _build_shared_trait_summary_lines(
        shared_traits,
        front_sample_size,
    )
    distributions = _build_distributions(products)
    insights = _build_insights(
        keyword=keyword,
        overview=overview,
        high_frequency_terms=high_frequency_terms,
        front_rank_terms=front_rank_terms,
        shared_traits=shared_traits,
        front_rank_summary_lines=front_rank_summary_lines,
        shared_trait_summary_lines=shared_trait_summary_lines,
    )

    return {
        "overview": overview,
        "high_frequency_terms": high_frequency_terms,
        "front_rank_terms": front_rank_terms,
        "shared_traits": shared_traits,
        "front_rank_summary_lines": front_rank_summary_lines,
        "shared_trait_summary_lines": shared_trait_summary_lines,
        "distributions": distributions,
        "insights": insights,
    }


def _build_overview(
    products: Sequence[SearchProduct],
    *,
    total_count: int,
    collected_pages: int,
    front_sample_size: int,
) -> dict[str, Any]:
    prices = [product.price for product in products if product.price > 0]
    sales_counts = [product.sales_count for product in products if product.sales_count >= 0]
    tagged_count = sum(1 for product in products if product.activity_tag.strip())
    tmall_count = sum(1 for product in products if product.is_tmall)
    p4p_count = sum(1 for product in products if product.is_p4p)
    unique_shops = len({product.shop_name for product in products if product.shop_name})
    unique_locations = len({product.location for product in products if product.location})

    return {
        "total_results": total_count,
        "sampled_products": len(products),
        "sampled_pages": collected_pages,
        "front_sample_size": front_sample_size,
        "unique_shops": unique_shops,
        "unique_locations": unique_locations,
        "tmall_count": tmall_count,
        "tmall_ratio": _safe_ratio(tmall_count, len(products)),
        "p4p_count": p4p_count,
        "p4p_ratio": _safe_ratio(p4p_count, len(products)),
        "activity_tagged_count": tagged_count,
        "activity_tagged_ratio": _safe_ratio(tagged_count, len(products)),
        "price": _number_stats(prices),
        "sales": _number_stats(sales_counts),
    }


def _number_stats(values: Sequence[float | int]) -> dict[str, float | int]:
    if not values:
        return {
            "count": 0,
            "min": 0,
            "max": 0,
            "average": 0,
            "median": 0,
        }

    average = sum(values) / len(values)
    return {
        "count": len(values),
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "average": round(average, 2),
        "median": round(float(median(values)), 2),
    }


def _build_distributions(products: Sequence[SearchProduct]) -> dict[str, Any]:
    price_buckets = _build_dynamic_money_buckets(
        product.price for product in products if product.price > 0
    )
    coupon_buckets = _build_dynamic_money_buckets(
        _coupon_amount(product)
        for product in products
        if _coupon_amount(product) is not None
    )

    return {
        "shop_types": _distribution_from_counter(
            Counter("天猫" if product.is_tmall else "淘宝" for product in products),
            len(products),
        ),
        "locations": _distribution_from_counter(
            Counter(product.location.strip() or "未知" for product in products),
            len(products),
        ),
        "activity_tags": _distribution_from_counter(
            Counter(product.activity_tag.strip() for product in products if product.activity_tag.strip()),
            len(products),
        ),
        "price_buckets": _distribution_from_counter(
            Counter(
                _bucket_money_value(product.price, price_buckets)
                for product in products
                if product.price > 0
            ),
            len(products),
        ),
        "coupon_buckets": _distribution_from_counter(
            Counter(
                _bucket_money_value(coupon_amount, coupon_buckets)
                for product in products
                if (coupon_amount := _coupon_amount(product)) is not None
            ),
            len(products),
        ),
        "sales_buckets": _distribution_from_counter(
            Counter(_bucket_sales(product.sales_count) for product in products if product.sales_count >= 0),
            len(products),
        ),
    }


def _empty_distributions() -> dict[str, list[dict[str, Any]]]:
    return {
        "shop_types": [],
        "locations": [],
        "activity_tags": [],
        "price_buckets": [],
        "coupon_buckets": [],
        "sales_buckets": [],
    }


def _distribution_from_counter(counter: Counter[str], total_size: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for label, count in counter.most_common():
        rows.append(
            {
                "label": label,
                "count": count,
                "coverage": _safe_ratio(count, total_size),
            }
        )
    return rows


def _extract_title_terms(title: str, keyword: str) -> set[str]:
    normalized = TITLE_SPLIT_RE.sub(" ", title.lower()).strip()
    if not normalized:
        return set()

    excluded_terms = _build_excluded_keyword_terms(keyword)
    terms: set[str] = set()

    for chinese_chunk in CHINESE_CHUNK_RE.findall(normalized):
        max_length = min(6, len(chinese_chunk))
        for length in range(2, max_length + 1):
            for index in range(len(chinese_chunk) - length + 1):
                term = chinese_chunk[index : index + length]
                if _is_valid_term(term, excluded_terms):
                    terms.add(term)

    for token in ALNUM_TOKEN_RE.findall(normalized):
        if _is_valid_term(token, excluded_terms):
            terms.add(token)

    return terms


def _build_excluded_keyword_terms(keyword: str) -> set[str]:
    normalized = TITLE_SPLIT_RE.sub("", keyword.lower())
    if not normalized:
        return set()

    excluded = {normalized}
    if len(normalized) >= 4:
        excluded.update(
            normalized[index : index + 2]
            for index in range(len(normalized) - 1)
            if normalized[index : index + 2]
        )
    return excluded


def _is_valid_term(term: str, excluded_terms: set[str]) -> bool:
    if not term or term in excluded_terms:
        return False
    if term in TITLE_TERM_STOPWORDS:
        return False
    if len(term) <= 1:
        return False
    if term.isdigit():
        return False
    if len(set(term)) == 1:
        return False
    return True


def _select_high_frequency_terms(
    counter: Counter[str], sample_size: int
) -> list[dict[str, Any]]:
    min_support = max(2, math.ceil(sample_size * 0.05))
    return _select_terms(
        counter=counter,
        sample_size=sample_size,
        min_support=min_support,
        limit=12,
    )


def _select_terms(
    *,
    counter: Counter[str],
    sample_size: int,
    min_support: int,
    limit: int,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []

    for term, count in sorted(counter.items(), key=lambda item: (-item[1], -len(item[0]), item[0])):
        if count < min_support:
            continue
        if any(term in item["term"] and count == item["title_count"] for item in selected):
            continue
        selected.append(
            {
                "term": term,
                "title_count": count,
                "coverage": _safe_ratio(count, sample_size),
            }
        )
        if len(selected) >= limit:
            break

    return selected


def _select_front_rank_terms(
    overall_counter: Counter[str],
    front_counter: Counter[str],
    sample_size: int,
    front_sample_size: int,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for term, front_count in front_counter.items():
        if front_count < 2:
            continue
        if _is_generic_front_term(term):
            continue
        overall_count = overall_counter.get(term, 0)
        front_coverage = _safe_ratio(front_count, front_sample_size)
        overall_coverage = _safe_ratio(overall_count, sample_size)
        delta = round(front_coverage - overall_coverage, 4)
        if delta < 0.06:
            continue
        candidates.append(
            {
                "term": term,
                "front_count": front_count,
                "front_coverage": front_coverage,
                "overall_count": overall_count,
                "overall_coverage": overall_coverage,
                "coverage_delta": delta,
            }
        )

    selected: list[dict[str, Any]] = []
    for item in sorted(
        candidates,
        key=lambda current: (
            -current["coverage_delta"],
            -len(current["term"]),
            -current["front_count"],
            current["term"],
        ),
    ):
        if _is_redundant_front_term(item, selected):
            continue
        selected.append(item)
        if len(selected) >= 8:
            break

    return selected


def _build_shared_traits(
    products: Sequence[SearchProduct], front_sample_size: int
) -> list[dict[str, Any]]:
    front_products = list(products[:front_sample_size])
    total_size = len(products)
    candidates: list[dict[str, Any]] = []
    price_buckets = _build_dynamic_money_buckets(
        product.price for product in products if product.price > 0
    )
    original_price_buckets = _build_dynamic_money_buckets(
        _parse_price_value(product.original_price)
        for product in products
        if _parse_price_value(product.original_price) > 0
    )
    coupon_buckets = _build_dynamic_money_buckets(
        _coupon_amount(product)
        for product in products
        if _coupon_amount(product) is not None
    )

    candidates.extend(
        _trait_rows_from_counter(
            trait_type="shop_type",
            counter=Counter("天猫" if product.is_tmall else "淘宝" for product in products),
            front_counter=Counter("天猫" if product.is_tmall else "淘宝" for product in front_products),
            total_size=total_size,
            front_sample_size=front_sample_size,
        )
    )
    candidates.extend(
        _trait_rows_from_counter(
            trait_type="price_bucket",
            counter=Counter(
                _bucket_money_value(product.price, price_buckets)
                for product in products
                if product.price > 0
            ),
            front_counter=Counter(
                _bucket_money_value(product.price, price_buckets)
                for product in front_products
                if product.price > 0
            ),
            total_size=total_size,
            front_sample_size=front_sample_size,
        )
    )
    candidates.extend(
        _trait_rows_from_counter(
            trait_type="original_price_bucket",
            counter=Counter(
                _bucket_money_value(_parse_price_value(product.original_price), original_price_buckets)
                for product in products
                if _parse_price_value(product.original_price) > 0
            ),
            front_counter=Counter(
                _bucket_money_value(_parse_price_value(product.original_price), original_price_buckets)
                for product in front_products
                if _parse_price_value(product.original_price) > 0
            ),
            total_size=total_size,
            front_sample_size=front_sample_size,
        )
    )
    candidates.extend(
        _trait_rows_from_counter(
            trait_type="coupon_bucket",
            counter=Counter(
                _bucket_money_value(coupon_amount, coupon_buckets)
                for product in products
                if (coupon_amount := _coupon_amount(product)) is not None
            ),
            front_counter=Counter(
                _bucket_money_value(coupon_amount, coupon_buckets)
                for product in front_products
                if (coupon_amount := _coupon_amount(product)) is not None
            ),
            total_size=total_size,
            front_sample_size=front_sample_size,
        )
    )
    candidates.extend(
        _trait_rows_from_counter(
            trait_type="activity_tag",
            counter=Counter(product.activity_tag.strip() for product in products if product.activity_tag.strip()),
            front_counter=Counter(
                product.activity_tag.strip()
                for product in front_products
                if product.activity_tag.strip()
            ),
            total_size=total_size,
            front_sample_size=front_sample_size,
        )
    )
    candidates.extend(
        _trait_rows_from_counter(
            trait_type="location_province",
            counter=Counter(_extract_location_province(product.location) for product in products if product.location.strip()),
            front_counter=Counter(
                _extract_location_province(product.location)
                for product in front_products
                if product.location.strip()
            ),
            total_size=total_size,
            front_sample_size=front_sample_size,
        )
    )
    candidates.extend(
        _trait_rows_from_counter(
            trait_type="location",
            counter=Counter(product.location.strip() or "未知" for product in products),
            front_counter=Counter(product.location.strip() or "未知" for product in front_products),
            total_size=total_size,
            front_sample_size=front_sample_size,
        )
    )
    candidates.extend(
        _trait_rows_from_booleans(
            label="有活动标签",
            trait_type="activity_flag",
            flags=[bool(product.activity_tag.strip()) for product in products],
            front_flags=[bool(product.activity_tag.strip()) for product in front_products],
        )
    )
    candidates.extend(
        _trait_rows_from_booleans(
            label="P4P商品",
            trait_type="p4p_flag",
            flags=[product.is_p4p for product in products],
            front_flags=[product.is_p4p for product in front_products],
        )
    )

    return _select_shared_trait_candidates(sorted(
        candidates,
        key=lambda item: (
            TRAIT_TYPE_PRIORITY.get(str(item.get("trait_type", "")), 99),
            -item["front_coverage"],
            -item["coverage_delta"],
            -item["front_count"],
            item["label"],
        ),
    ))


def _trait_rows_from_counter(
    *,
    trait_type: str,
    counter: Counter[str],
    front_counter: Counter[str],
    total_size: int,
    front_sample_size: int,
) -> list[dict[str, Any]]:
    rule = _trait_selection_rule(trait_type)
    rows: list[dict[str, Any]] = []
    for label, front_count in front_counter.items():
        if front_count < rule["min_front_count"]:
            continue
        total_count = counter.get(label, 0)
        front_coverage = _safe_ratio(front_count, front_sample_size)
        total_coverage = _safe_ratio(total_count, total_size)
        delta = round(front_coverage - total_coverage, 4)
        if front_coverage < rule["min_front_coverage"]:
            continue
        if delta < rule["min_delta"]:
            continue
        rows.append(
            {
                "trait_type": trait_type,
                "label": label,
                "front_count": front_count,
                "front_coverage": front_coverage,
                "overall_count": total_count,
                "overall_coverage": total_coverage,
                "coverage_delta": delta,
            }
        )
    return rows


def _trait_rows_from_booleans(
    *,
    label: str,
    trait_type: str,
    flags: Sequence[bool],
    front_flags: Sequence[bool],
) -> list[dict[str, Any]]:
    rule = _trait_selection_rule(trait_type)
    total_size = len(flags)
    front_size = len(front_flags)
    total_count = sum(1 for flag in flags if flag)
    front_count = sum(1 for flag in front_flags if flag)
    if front_count < rule["min_front_count"]:
        return []

    front_coverage = _safe_ratio(front_count, front_size)
    total_coverage = _safe_ratio(total_count, total_size)
    delta = round(front_coverage - total_coverage, 4)
    if front_coverage < rule["min_front_coverage"]:
        return []
    if delta < rule["min_delta"]:
        return []

    return [
        {
            "trait_type": trait_type,
            "label": label,
            "front_count": front_count,
            "front_coverage": front_coverage,
            "overall_count": total_count,
            "overall_coverage": total_coverage,
            "coverage_delta": delta,
        }
    ]


def _bucket_sales(sales_count: int) -> str:
    for start, end, label in SALES_BUCKETS:
        if end is None and sales_count >= start:
            return label
        if end is not None and start <= sales_count <= end:
            return label
    return "未知"


def _coupon_amount(product: SearchProduct) -> float | None:
    original_price = _parse_price_value(product.original_price)
    current_price = product.price if product.price > 0 else _parse_price_value(product.current_price)
    if original_price <= 0 or current_price <= 0 or current_price > original_price:
        return None

    coupon_amount = round(original_price - current_price, 2)
    if coupon_amount <= 0:
        return None
    return coupon_amount


def _resolve_front_sample_size(sample_size: int) -> int:
    if sample_size <= 0:
        return 0
    if sample_size <= 200:
        return min(50, sample_size)
    additional_blocks = math.ceil((sample_size - 200) / 100)
    return min(sample_size, 50 + additional_blocks * 20)


def _build_dynamic_money_buckets(values: Iterable[float | None]) -> list[tuple[float, float, str]]:
    cleaned = sorted(
        round(float(value), 2)
        for value in values
        if value is not None and float(value) >= 0
    )
    if not cleaned:
        return []

    unique_values = sorted(set(cleaned))
    if len(unique_values) == 1:
        value = unique_values[0]
        return [(value, value, f"{_format_money_value(value)}元")]

    bucket_count = min(5, len(unique_values))
    edges = [
        cleaned[round((len(cleaned) - 1) * index / bucket_count)]
        for index in range(bucket_count + 1)
    ]
    if len(set(edges)) < 2:
        edges = [
            unique_values[round((len(unique_values) - 1) * index / bucket_count)]
            for index in range(bucket_count + 1)
        ]

    deduped_edges: list[float] = []
    for edge in edges:
        if not deduped_edges or edge != deduped_edges[-1]:
            deduped_edges.append(edge)

    if len(deduped_edges) == 1:
        value = deduped_edges[0]
        return [(value, value, f"{_format_money_value(value)}元")]

    buckets: list[tuple[float, float, str]] = []
    for index in range(len(deduped_edges) - 1):
        start = deduped_edges[index]
        end = deduped_edges[index + 1]
        buckets.append((start, end, _format_money_range(start, end)))
    return buckets


def _bucket_money_value(value: float, buckets: Sequence[tuple[float, float, str]]) -> str:
    if not buckets:
        return "未知"
    for index, (start, end, label) in enumerate(buckets):
        if index == len(buckets) - 1:
            if start <= value <= end:
                return label
        elif start <= value < end:
            return label
    if value < buckets[0][0]:
        return buckets[0][2]
    return buckets[-1][2]


def _format_money_range(start: float, end: float) -> str:
    if start == end:
        return f"{_format_money_value(start)}元"
    return f"{_format_money_value(start)}-{_format_money_value(end)}元"


def _format_money_value(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _extract_location_province(location: str) -> str:
    text = (location or "").strip()
    if not text:
        return ""
    return text.split()[0]


def _parse_price_value(value: Any) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return 0.0


def _build_insights(
    *,
    keyword: str,
    overview: dict[str, Any],
    high_frequency_terms: Sequence[dict[str, Any]],
    front_rank_terms: Sequence[dict[str, Any]],
    shared_traits: Sequence[dict[str, Any]],
    front_rank_summary_lines: Sequence[str],
    shared_trait_summary_lines: Sequence[str],
) -> list[str]:
    insights: list[str] = []
    sampled_products = overview.get("sampled_products", 0)
    total_results = overview.get("total_results", 0)
    front_sample_size = overview.get("front_sample_size", 0)
    price_stats = overview.get("price", {})
    sales_stats = overview.get("sales", {})

    insights.append(
        f"本次以“{keyword}”为关键词，实际分析了 {sampled_products} 个商品样本；"
        f"总商品数为 {total_results}。"
    )
    insights.append(
        f"样本价格中位数为 {price_stats.get('median', 0)} 元，平均价格为 {price_stats.get('average', 0)} 元；"
        f"销量中位数为 {sales_stats.get('median', 0)}。"
    )

    if high_frequency_terms:
        term_summary = "、".join(
            f"{item['term']}（{item['title_count']}条）" for item in high_frequency_terms[:5]
        )
        insights.append(f"标题高频词主要集中在：{term_summary}。")

    if front_rank_terms:
        term_summary = "；".join(front_rank_summary_lines[:3])
        insights.append(
            f"在当前前 {front_sample_size} 名样本里，更常见的标题词有：{term_summary}。"
        )

    if shared_traits:
        trait_summary = "；".join(shared_trait_summary_lines[:4])
        insights.append(
            f"从当前前 {front_sample_size} 名样本看，更集中的共性包括：{trait_summary}。"
        )

    return insights


def _build_front_rank_summary_lines(
    front_rank_terms: Sequence[dict[str, Any]],
    front_sample_size: int,
) -> list[str]:
    lines: list[str] = []
    for item in front_rank_terms:
        lines.append(
            f"{item['term']}（前{front_sample_size}占比"
            f"{_ratio_to_percent_text(item.get('front_coverage', 0))}，"
            f"整体占比{_ratio_to_percent_text(item.get('overall_coverage', 0))}）"
        )
    return lines


def _is_generic_front_term(term: str) -> bool:
    text = str(term or "").strip().lower()
    if not text:
        return True
    return text in GENERIC_FRONT_TERM_STOPWORDS


def _is_redundant_front_term(
    current: dict[str, Any],
    selected: Sequence[dict[str, Any]],
) -> bool:
    current_term = str(current.get("term", ""))
    current_front_count = int(current.get("front_count", 0) or 0)
    current_overall_count = int(current.get("overall_count", 0) or 0)

    for existing in selected:
        existing_term = str(existing.get("term", ""))
        existing_front_count = int(existing.get("front_count", 0) or 0)
        existing_overall_count = int(existing.get("overall_count", 0) or 0)
        if not existing_term:
            continue

        if current_term in existing_term:
            if (
                current_front_count == existing_front_count
                or current_overall_count == existing_overall_count
            ):
                return True
            if len(current_term) <= len(existing_term) and current_front_count <= existing_front_count:
                return True

    return False


def _build_shared_trait_summary_lines(
    shared_traits: Sequence[dict[str, Any]],
    front_sample_size: int,
) -> list[str]:
    lines: list[str] = []
    for item in shared_traits:
        label = _format_trait_summary_label(
            item.get("trait_type", ""),
            item.get("label", ""),
        )
        lines.append(
            f"{label}（前{front_sample_size}占比"
            f"{_ratio_to_percent_text(item.get('front_coverage', 0))}，"
            f"整体占比{_ratio_to_percent_text(item.get('overall_coverage', 0))}）"
        )
    return lines


def _trait_selection_rule(trait_type: str) -> dict[str, float | int]:
    return TRAIT_SELECTION_RULES.get(
        trait_type,
        {"min_front_count": 3, "min_front_coverage": 0.1, "min_delta": 0.03},
    )


def _select_shared_trait_candidates(
    candidates: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    selected_count_by_type: Counter[str] = Counter()

    for item in candidates:
        trait_type = str(item.get("trait_type", ""))
        trait_group = TRAIT_TYPE_GROUP_MAP.get(trait_type, trait_type)
        max_items = TRAIT_TYPE_MAX_ITEMS.get(trait_group, TRAIT_TYPE_MAX_ITEMS.get(trait_type, 1))
        if selected_count_by_type[trait_group] >= max_items:
            continue
        selected.append(item)
        selected_count_by_type[trait_group] += 1
        if len(selected) >= 8:
            break

    return selected


def _format_trait_summary_label(trait_type: Any, label: Any) -> str:
    trait_key = str(trait_type or "")
    text = str(label or "").strip()
    if trait_key == "location":
        text = text.replace(" ", "")
    template = TRAIT_SUMMARY_LABEL_MAP.get(trait_key)
    if template:
        return template.format(label=text)
    return text or "该特征"


def _ratio_to_percent_text(value: Any) -> str:
    try:
        percent = float(value) * 100
    except (TypeError, ValueError):
        return "0%"
    rounded = round(percent)
    if abs(percent - rounded) < 0.05:
        return f"{rounded:.0f}%"
    return f"{percent:.1f}%"


def _safe_ratio(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(count / total, 4)
