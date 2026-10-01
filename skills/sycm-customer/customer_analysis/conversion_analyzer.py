"""电商店铺客户分群转化自动化分析。"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from .types import SkillOutput

SKILL_NAME = "店铺客户分群转化分析报告"

DeviationLevel = Literal["severe", "mild", "normal", "insufficient"]
MatchLevel = Literal["严重不匹配", "轻度偏差", "正常匹配", "数据不足"]


@dataclass
class SegmentMetrics:
    count: float = 0.0
    pay_rate: float | None = None
    aov: float | None = None
    pay_amt_ratio: float | None = None
    recall: float | None = None


@dataclass
class DimensionMatch:
    name: str
    level: DeviationLevel
    label: str
    summary: str


@dataclass
class MatchAnalysis:
    dimensions: list[DimensionMatch] = field(default_factory=list)
    overall_level: MatchLevel = "数据不足"
    root_problem: str = ""


@dataclass
class AnalysisContext:
    stat_date: str = ""
    profile_range: str = ""
    total_customers: float = 0.0
    total_yoy: float | None = None
    segments: dict[str, SegmentMetrics] = field(default_factory=dict)
    profiles: dict[str, dict[str, list[dict[str, Any]]]] = field(default_factory=dict)
    price_level: str = ""
    cycle_type: str = ""
    cycle_ratio: float | None = None
    is_undertake_abnormal: bool = False
    core_operation_direction: str = ""
    match: MatchAnalysis = field(default_factory=MatchAnalysis)
    flow_status: str = ""
    structure_type: str = ""


def _metric_value(overview: dict[str, Any], key: str) -> float | None:
    raw = overview.get(key)
    if not raw or not isinstance(raw, dict):
        return None
    value = raw.get("value")
    if value is None:
        return None
    return float(value)


def _metric_yoy(overview: dict[str, Any], key: str) -> float | None:
    raw = overview.get(key)
    if not raw or not isinstance(raw, dict):
        return None
    value = raw.get("cycle_crc")
    if value is None:
        return None
    return float(value)


def _pct(value: float | None, digits: int = 2) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.{digits}f}%"


def _money(value: float | None) -> str:
    if value is None:
        return "—"
    return f"¥{value:,.2f}"


def _yoy_text(value: float | None) -> str:
    if value is None:
        return "—"
    prefix = "+" if value > 0 else ""
    return f"{prefix}{value * 100:.2f}%"


def _share(count: float, total: float) -> float:
    if total <= 0:
        return 0.0
    return count / total


def _deviation_label(level: DeviationLevel) -> str:
    return {
        "severe": "严重偏差",
        "mild": "轻度偏差",
        "normal": "正常匹配",
        "insufficient": "数据不足",
    }[level]


def _normalize_power_level(name: str) -> str:
    match = re.search(r"L\d+", name)
    return match.group(0) if match else name


def _ranked_items(
    ctx: AnalysisContext,
    crowd_type: str,
    attribute: str,
    *,
    top_n: int = 3,
) -> list[tuple[str, float, int]]:
    rows = (ctx.profiles.get(crowd_type) or {}).get(attribute) or []
    items: list[tuple[str, float, int]] = []
    for index, row in enumerate(rows[:top_n], start=1):
        name = str(row.get("attr_value") or "")
        ratio = row.get("ratio")
        if not name or ratio is None:
            continue
        items.append((name, float(ratio), index))
    return items


def _gender_ratios(ctx: AnalysisContext, crowd_type: str) -> dict[str, float]:
    rows = (ctx.profiles.get(crowd_type) or {}).get("gender") or []
    ratios: dict[str, float] = {}
    for row in rows:
        name = str(row.get("attr_value") or "")
        ratio = row.get("ratio")
        if name and ratio is not None:
            ratios[name] = float(ratio)
    return ratios


def _main_gender(ratios: dict[str, float]) -> tuple[str, float] | None:
    if not ratios:
        return None
    name = max(ratios, key=ratios.get)
    return name, ratios[name]


def _is_opposite_gender(a: str, b: str) -> bool:
    male_keys = {"男", "男性", "male"}
    female_keys = {"女", "女性", "female"}
    a_male = any(key in a for key in male_keys)
    a_female = any(key in a for key in female_keys)
    b_male = any(key in b for key in male_keys)
    b_female = any(key in b for key in female_keys)
    return (a_male and b_female) or (a_female and b_male)


def _analyze_purchase_power(ctx: AnalysisContext) -> DimensionMatch:
    new_top = _ranked_items(ctx, "new_crowd", "purchase_power", top_n=3)
    purch_top = _ranked_items(ctx, "purch_crowd", "purchase_power", top_n=3)
    if not new_top or not purch_top:
        return DimensionMatch(
            name="消费层级",
            level="insufficient",
            label=_deviation_label("insufficient"),
            summary="数据不足，跳过本维度分析",
        )

    new_levels = [_normalize_power_level(name) for name, _, _ in new_top]
    purch_levels = [_normalize_power_level(name) for name, _, _ in purch_top]
    overlap = len(set(new_levels) & set(purch_levels))
    new_main_level, new_main_ratio = _normalize_power_level(new_top[0][0]), new_top[0][1]
    purch_main_level, purch_main_ratio = _normalize_power_level(purch_top[0][0]), purch_top[0][1]
    main_same = new_main_level == purch_main_level
    ratio_gap = abs(new_main_ratio - purch_main_ratio)

    new_text = "、".join(f"{_normalize_power_level(n)}（{_pct(r)}）" for n, r, _ in new_top)
    purch_text = "、".join(f"{_normalize_power_level(n)}（{_pct(r)}）" for n, r, _ in purch_top)

    if overlap <= 1 or not main_same:
        level: DeviationLevel = "severe"
        summary = (
            f"新访 TOP3：{new_text}；已购 TOP3：{purch_text}。"
            f"TOP3 重合 {overlap} 个，主力层级 {new_main_level} vs {purch_main_level}，"
            "消费层级错位明显。"
        )
    elif overlap == 2 and main_same and ratio_gap > 0.10:
        level = "mild"
        summary = (
            f"新访与已购主力层级均为 {new_main_level}，但占比差 {_pct(ratio_gap)}，"
            "存在轻度结构偏差。"
        )
    elif overlap == 3 and main_same and ratio_gap <= 0.10:
        level = "normal"
        summary = (
            f"新访与已购 TOP3 完全重合，主力层级 {new_main_level} 一致且占比差 {_pct(ratio_gap)}，"
            "消费层级匹配良好。"
        )
    else:
        level = "mild"
        summary = (
            f"新访 TOP3 与已购 TOP3 重合 {overlap} 个，主力层级一致但结构仍有差异，"
            "需持续观察。"
        )

    return DimensionMatch("消费层级", level, _deviation_label(level), summary)


def _analyze_gender(ctx: AnalysisContext) -> DimensionMatch:
    new_ratios = _gender_ratios(ctx, "new_crowd")
    purch_ratios = _gender_ratios(ctx, "purch_crowd")
    new_main = _main_gender(new_ratios)
    purch_main = _main_gender(purch_ratios)
    if not new_main or not purch_main:
        return DimensionMatch(
            name="性别",
            level="insufficient",
            label=_deviation_label("insufficient"),
            summary="数据不足，跳过本维度分析",
        )

    new_name, new_ratio = new_main
    purch_name, purch_ratio = purch_main
    same_gender = not _is_opposite_gender(new_name, purch_name)
    shared_ratio = new_ratios.get(purch_name, purch_ratios.get(new_name))
    diff = abs(new_ratio - purch_ratio) if shared_ratio is None else abs(new_ratio - shared_ratio)

    if not same_gender or diff >= 0.15:
        level: DeviationLevel = "severe"
        summary = (
            f"新访主力 {new_name}（{_pct(new_ratio)}），已购主力 {purch_name}（{_pct(purch_ratio)}），"
            f"性别结构偏差显著（差值 {_pct(diff)}）。"
        )
    elif same_gender and 0.08 <= diff < 0.15:
        level = "mild"
        summary = (
            f"主力性别均为 {new_name}，但占比差 {_pct(diff)}，存在轻度偏差。"
        )
    else:
        level = "normal"
        summary = (
            f"主力性别均为 {new_name}，占比差 {_pct(diff)}，性别结构匹配正常。"
        )

    return DimensionMatch("性别", level, _deviation_label(level), summary)


def _analyze_age(ctx: AnalysisContext) -> DimensionMatch:
    new_top = _ranked_items(ctx, "new_crowd", "age", top_n=2)
    purch_top = _ranked_items(ctx, "purch_crowd", "age", top_n=2)
    if not new_top or not purch_top:
        return DimensionMatch(
            name="年龄",
            level="insufficient",
            label=_deviation_label("insufficient"),
            summary="数据不足，跳过本维度分析",
        )

    new_names = [name for name, _, _ in new_top]
    purch_names = [name for name, _, _ in purch_top]
    overlap = len(set(new_names) & set(purch_names))
    new_text = "、".join(f"{n}（{_pct(r)}）" for n, r, _ in new_top)
    purch_text = "、".join(f"{n}（{_pct(r)}）" for n, r, _ in purch_top)

    if overlap == 0:
        level: DeviationLevel = "severe"
        summary = (
            f"新访核心年龄 {new_text}；已购核心年龄 {purch_text}。"
            "核心年龄 TOP2 完全无重合，人群年龄错位。"
        )
    elif overlap == 1:
        level = "mild"
        summary = (
            f"新访与已购核心年龄 TOP2 仅重合 1 个，次主力区间差异较大，"
            f"新访 {new_text}，已购 {purch_text}。"
        )
    else:
        level = "normal"
        summary = (
            f"新访与已购核心年龄 TOP2 完全重合（{new_text}），年龄结构匹配正常。"
        )

    return DimensionMatch("年龄", level, _deviation_label(level), summary)


def _compute_match_analysis(ctx: AnalysisContext) -> MatchAnalysis:
    dimensions = [
        _analyze_purchase_power(ctx),
        _analyze_gender(ctx),
        _analyze_age(ctx),
    ]
    valid = [item for item in dimensions if item.level != "insufficient"]
    if not valid:
        return MatchAnalysis(
            dimensions=dimensions,
            overall_level="数据不足",
            root_problem="画像数据不足，暂无法判定人群匹配度，建议补齐新访与已购画像后重跑。",
        )

    severe_count = sum(1 for item in valid if item.level == "severe")
    mild_count = sum(1 for item in valid if item.level == "mild")
    purchase_severe = any(
        item.name == "消费层级" and item.level == "severe" for item in valid
    )

    if severe_count >= 2 or purchase_severe:
        overall: MatchLevel = "严重不匹配"
        root = (
            "**根源问题**：前端流量标签混乱，新客人群与成交人群错位，"
            "优先修正流量精准度，货品 / 承接优化后置。"
        )
    elif severe_count == 1 or mild_count >= 1:
        overall = "轻度偏差"
        root = (
            "**根源问题**：流量存在无效占比，需同步优化流量精准度与转化承接。"
        )
    else:
        overall = "正常匹配"
        root = (
            "**根源问题**：流量精准度合格，优化重心在转化、承接、复购。"
        )

    return MatchAnalysis(dimensions=dimensions, overall_level=overall, root_problem=root)


def _build_context(result: SkillOutput) -> AnalysisContext:
    overview = result.overview or {}
    ctx = AnalysisContext(
        stat_date=result.stat_date or result.date_range,
        profile_range=result.profile_date_range or "",
        total_customers=_metric_value(overview, "shopCustomer") or 0.0,
        total_yoy=_metric_yoy(overview, "shopCustomer"),
    )
    ctx.segments = {
        "new_crowd": SegmentMetrics(
            count=_metric_value(overview, "newVisitorCnt") or 0.0,
            pay_rate=_metric_value(overview, "newVisitorPayRate"),
            aov=_metric_value(overview, "newVisitorPct"),
            pay_amt_ratio=_metric_value(overview, "newVisitorPayAmtRatio"),
            recall=_metric_value(overview, "newVisitorReCall"),
        ),
        "unpur_crowd": SegmentMetrics(
            count=_metric_value(overview, "noPurchaseCnt") or 0.0,
            pay_rate=_metric_value(overview, "noPurchasePayRate"),
            aov=_metric_value(overview, "noPurchasePct"),
            pay_amt_ratio=_metric_value(overview, "noPurchasePayAmtRatio"),
            recall=_metric_value(overview, "noPurchaseReCall"),
        ),
        "purch_crowd": SegmentMetrics(
            count=_metric_value(overview, "hasPurchaseCnt") or 0.0,
            pay_rate=_metric_value(overview, "hasPurchasePayRate"),
            aov=_metric_value(overview, "hasPurchasePct"),
            pay_amt_ratio=_metric_value(overview, "hasPurchasePayAmtRatio"),
            recall=_metric_value(overview, "hasPurchaseReCall"),
        ),
    }

    for profile in result.profiles or []:
        crowd = str(profile.get("crowd_type") or "")
        attr = str(profile.get("attribute_name") or "")
        if not crowd or not attr:
            continue
        rows = sorted(
            list(profile.get("rows") or []),
            key=lambda item: float(item.get("shop_customer_cnt") or 0),
            reverse=True,
        )
        ctx.profiles.setdefault(crowd, {})[attr] = rows

    new_aov = ctx.segments["new_crowd"].aov or 0.0
    if new_aov < 100:
        ctx.price_level = "低客单价"
    elif new_aov < 300:
        ctx.price_level = "中客单价"
    else:
        ctx.price_level = "高客单价"

    new_rate = ctx.segments["new_crowd"].pay_rate
    unpur_rate = ctx.segments["unpur_crowd"].pay_rate
    if new_rate and unpur_rate and unpur_rate > 0:
        ctx.cycle_ratio = new_rate / unpur_rate

    if ctx.cycle_ratio is None:
        ctx.cycle_type = "数据不足"
    elif ctx.cycle_ratio <= 1.5:
        ctx.cycle_type = "短转化周期"
    elif ctx.cycle_ratio < 2:
        ctx.cycle_type = "过渡型转化周期"
    else:
        ctx.cycle_type = "中长转化周期"

    ctx.is_undertake_abnormal = (
        ctx.cycle_type == "中长转化周期"
        and new_rate is not None
        and unpur_rate is not None
        and unpur_rate < new_rate
    )

    if ctx.cycle_type == "短转化周期":
        ctx.core_operation_direction = (
            "以**新访首次成交**为核心，老客复购做增量补充。"
        )
    elif ctx.cycle_type == "中长转化周期":
        ctx.core_operation_direction = (
            "以**新访拉新蓄水 + 未购回访承接成交**为主线，老客复购做长期增值。"
        )
    elif ctx.cycle_type == "过渡型转化周期":
        ctx.core_operation_direction = (
            "新访成交与未购承接**双线并行**，避免单点依赖。"
        )
    else:
        ctx.core_operation_direction = "补齐核心转化数据后，再明确运营主线。"

    yoy = ctx.total_yoy
    if yoy is None:
        ctx.flow_status = "持平（缺少环比数据）"
    elif yoy > 0.02:
        ctx.flow_status = f"正增长（环比 {_yoy_text(yoy)}）"
    elif yoy < -0.02:
        ctx.flow_status = f"负增长（环比 {_yoy_text(yoy)}）"
    else:
        ctx.flow_status = f"持平（环比 {_yoy_text(yoy)}）"

    total = ctx.total_customers or 1.0
    new_share = _share(ctx.segments["new_crowd"].count, total)
    purch_share = _share(ctx.segments["purch_crowd"].count, total)
    structure_notes: list[str] = []
    if new_share > 0.80:
        structure_notes.append("新访依赖型（新访占比 > 80%，存量运营缺位）")
    elif new_share >= 0.60:
        structure_notes.append("结构均衡型（新访 60%~80%，回访与老客占比相对合理）")
    else:
        structure_notes.append("回访驱动型（新访占比 < 60%，存量运营占比较高）")
    if purch_share < 0.05:
        structure_notes.append("老客缺失型（已购回访占比 < 5%，复购体系缺失）")
    ctx.structure_type = "；".join(structure_notes)

    ctx.match = _compute_match_analysis(ctx)
    return ctx


def _cycle_type_text(ctx: AnalysisContext) -> str:
    new_rate = ctx.segments["new_crowd"].pay_rate
    unpur_rate = ctx.segments["unpur_crowd"].pay_rate
    if ctx.cycle_ratio is not None:
        text = f"{ctx.cycle_type}（转化率比值 {ctx.cycle_ratio:.2f}）"
    else:
        text = ctx.cycle_type
    if ctx.is_undertake_abnormal and new_rate is not None:
        text += (
            f"；异常标记：未购承接运营缺位"
            f"（未购回访转化率 {_pct(unpur_rate)} ＜ 新访转化率 {_pct(new_rate)}）"
        )
    return text


def _new_segment_conclusion(ctx: AnalysisContext) -> str:
    new = ctx.segments["new_crowd"]
    total = ctx.total_customers or 1.0
    scale = "流量规模大" if _share(new.count, total) >= 0.70 else "流量规模中等"
    convert = "转化效率尚可" if (new.pay_rate or 0) >= 0.03 else "转化效率偏低，需优先提升"
    aov = f"客单价 {_money(new.aov)}，属{ctx.price_level}区间"
    revenue = (
        f"支付金额占比 {_pct(new.pay_amt_ratio)}，营收贡献{'高度集中' if (new.pay_amt_ratio or 0) >= 0.85 else '占主导'}"
    )
    recall = (
        f"潜在客户召回率 {_pct(new.recall)}，{'召回能力良好' if (new.recall or 0) >= 0.05 else '召回仍有提升空间'}"
        if new.recall is not None
        else "召回率数据缺失"
    )
    return f"{scale}；{convert}；{aov}；{revenue}；{recall}。"


def _unpur_segment_conclusion(ctx: AnalysisContext) -> str:
    new = ctx.segments["new_crowd"]
    unpur = ctx.segments["unpur_crowd"]
    total = ctx.total_customers or 1.0
    scale = f"召回池规模占比 {_pct(_share(unpur.count, total))}"
    if (unpur.pay_rate or 0) < (new.pay_rate or 0):
        convert = "**转化效率低于新访，承接缺位**"
    else:
        convert = "转化效率符合品类规律，重点在扩大激活"
    aov = f"客单价 {_money(unpur.aov)}"
    revenue = f"支付金额占比 {_pct(unpur.pay_amt_ratio)}"
    recall = (
        f"未购召回率 {_pct(unpur.recall)}"
        if unpur.recall is not None
        else "召回率数据缺失"
    )
    profile_gap = ""
    if ctx.match.overall_level == "严重不匹配":
        profile_gap = "；画像与新访存在明显错位，承接素材需对齐已购成交人群"
    elif ctx.match.overall_level == "轻度偏差":
        profile_gap = "；画像与新访存在轻度差异，需分层召回精准触达"
    return f"{scale}；{convert}；{aov}；{revenue}；{recall}{profile_gap}。"


def _purch_segment_conclusion(ctx: AnalysisContext) -> str:
    purch = ctx.segments["purch_crowd"]
    total = ctx.total_customers or 1.0
    scale = f"老客回访规模占比 {_pct(_share(purch.count, total))}"
    if (purch.pay_rate or 0) <= 0.01 and purch.count > 0:
        convert = "**复购转化率接近零，复购体系断层**"
        maturity = "复购体系成熟度：尚未建立"
    elif (purch.pay_rate or 0) >= 0.05:
        convert = "复购转化率表现良好"
        maturity = "复购体系成熟度：初步成型"
    else:
        convert = "复购转化率偏低，仍有较大提升空间"
        maturity = "复购体系成熟度：待加强"
    aov = f"复购客单价 {_money(purch.aov)}"
    recall = (
        f"已购召回率 {_pct(purch.recall)}"
        if purch.recall is not None
        else "召回率数据缺失"
    )
    return f"{scale}；{convert}；{aov}；{recall}；{maturity}。"


def _bottlenecks(ctx: AnalysisContext) -> list[str]:
    items: list[str] = []
    if ctx.match.overall_level == "严重不匹配":
        items.append("根源瓶颈：前端流量标签混乱，新客与成交人群错位")
    elif ctx.match.overall_level == "轻度偏差":
        items.append("根源瓶颈：流量精准度存在无效占比，需同步优化标签与承接")

    new = ctx.segments["new_crowd"]
    unpur = ctx.segments["unpur_crowd"]
    purch = ctx.segments["purch_crowd"]
    total = ctx.total_customers or 1.0

    if _share(new.count, total) > 0.80:
        items.append("前端瓶颈：新访流量过度依赖拉新，结构失衡")
    if (new.pay_rate or 0) < 0.04:
        items.append("前端瓶颈：新访转化率与首单决策效率不足")
    if ctx.is_undertake_abnormal or (unpur.pay_rate or 0) < (new.pay_rate or 0):
        items.append("中端瓶颈：未购召回率 / 回访承接转化率不足")
    if (purch.pay_rate or 0) <= 0.01 and purch.count > 0:
        items.append("后端瓶颈：老客复购断层，用户生命周期价值低")
    if (new.pay_amt_ratio or 0) >= 0.85:
        items.append("后端瓶颈：营收过度集中新访，链路抗风险能力偏弱")

    if not items:
        items.append("全链路相对均衡，重点在精细化提效")
    return items[:5]


def _profile_hint(ctx: AnalysisContext, crowd_type: str) -> str:
    purchase = _ranked_items(ctx, crowd_type, "purchase_power", top_n=1)
    interest = _ranked_items(ctx, crowd_type, "interest", top_n=2)
    parts: list[str] = []
    if purchase:
        parts.append(f"主力消费层级 {_normalize_power_level(purchase[0][0])}")
    if interest:
        parts.append("核心兴趣 " + "、".join(name for name, _, _ in interest))
    return "、".join(parts) if parts else "核心客群"


def _dedupe_tools(tools: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for tool in tools:
        key = tool.split("（", 1)[0].strip()
        if key in seen:
            continue
        seen.add(key)
        result.append(tool)
    return result


def _new_visitor_marketing_line(ctx: AnalysisContext) -> str:
    """按客单价与转化阶段匹配新访营销工具（仅推荐当前节点所需）。"""
    new = ctx.segments["new_crowd"]
    pay_rate = new.pay_rate or 0
    tools: list[str] = []

    if ctx.match.overall_level == "严重不匹配":
        tools.extend([
            "首单礼金（精准拉新，不计历史最低价，修正人群标签）",
            "营销托管·新客（按成交付费，控制拉新成本）",
        ])
    elif ctx.price_level == "低客单价":
        tools.append("首单礼金（中低客单拉新，不计历史最低价）")
        if pay_rate < 0.03:
            tools.append("天天特卖 / 营销托管·新客（冷启动破零起量）")
        else:
            tools.append("超级立减（日常转化兜底，需近 60 天动销≥1）")
    elif ctx.price_level == "中客单价":
        tools.append("首单礼金 + 超级立减（拉新 + 日常转化组合）")
        tools.append("天猫 U 先（试用装拉新，沉淀正装回购人群）")
        if pay_rate < 0.04:
            tools.append("营销托管·新客（合规起量，按成交付费）")
    else:
        tools.append("首单礼金（低比例让利，降低高客单首单门槛）")
        if pay_rate < 0.04:
            tools.extend([
                "店铺 AI 红包（针对浏览 / 加购未付潜客）",
                "营销托管·新客（按成交付费测试精准人群）",
            ])
        else:
            tools.append("超级立减（成熟链接日销维稳，需满足 15 天普惠价门槛）")
            if pay_rate >= 0.05:
                tools.append("广告智能跟投（放大高转化单品付费流量）")

    if pay_rate < 0.04 and not any("店铺 AI 红包" in t for t in tools):
        tools.append("店铺 AI 红包（提升潜客下单转化）")

    picked = _dedupe_tools(tools)[:3]
    return f"- **营销活动**：{' + '.join(picked)}。"


def _unpur_marketing_line(ctx: AnalysisContext) -> str:
    """未购回访承接节点：定向让利，不破坏全域价格体系。"""
    unpur = ctx.segments["unpur_crowd"]
    new = ctx.segments["new_crowd"]
    tools: list[str] = []

    if ctx.is_undertake_abnormal or (unpur.pay_rate or 0) < (new.pay_rate or 0):
        tools.extend([
            "单品宝（设置回访专属限时价，降低二次决策门槛）",
            "店铺 AI 红包（定向触达浏览 / 加购未购用户）",
        ])
    if ctx.cycle_type in {"中长转化周期", "过渡型转化周期"}:
        tools.append("超级立减（二次触达价格兜底，可与跨店满减叠加）")
    if ctx.price_level == "高客单价":
        tools.append("无界智惠券（配合万相台投放，平台补贴提升到手价）")
    elif ctx.price_level == "低客单价":
        tools.append("店铺宝满减（引导凑单，提升回访客单）")

    if not tools:
        tools.append("单品宝（回访专属权益，配合分层召回素材）")

    picked = _dedupe_tools(tools)[:3]
    return f"- **营销活动**：{' + '.join(picked)}。"


def _purch_marketing_line(ctx: AnalysisContext) -> str:
    """已购回访 / 复购节点：老客专属让利与连带提升。"""
    purch = ctx.segments["purch_crowd"]
    pay_rate = purch.pay_rate or 0
    tools: list[str] = []

    if pay_rate <= 0.01 and purch.count > 0:
        tools.extend([
            "老客礼金·沉默召回（唤醒已购未复购用户）",
            "店铺宝满减 / 满包邮（降低复购凑单门槛）",
        ])
    elif pay_rate < 0.05:
        tools.extend([
            "老客礼金·复购激励（定向老客专属满减）",
            "搭配宝（互补 SKU 组合优惠，提升连带）",
        ])
    else:
        tools.extend([
            "老客礼金（复购维稳）",
            "店铺宝满赠（提升客单与粘性）",
        ])

    if ctx.price_level == "高客单价" and pay_rate <= 0.01:
        tools.append("超级立减（成熟爆款日销维稳，配合复购触达）")

    picked = _dedupe_tools(tools)[:3]
    return f"- **营销活动**：{' + '.join(picked)}。"


def _tag_fix_marketing_line(ctx: AnalysisContext) -> str:
    return (
        "- **营销配合**：修正标签阶段优先用 **首单礼金 + 营销托管·新客** 小预算测精准人群，"
        "避免百亿补贴 / 天天特卖等泛流量频道放大错位流量。"
    )


def _module_actions(ctx: AnalysisContext) -> list[str]:
    lines: list[str] = []
    if ctx.match.overall_level == "严重不匹配":
        purch_hint = _profile_hint(ctx, "purch_crowd")
        lines.extend([
            "#### 模块 0：人群标签修正专项（特级优先级）",
            "- **付费端**：收缩泛人群 / 宽泛词投放，集中预算到精准人群计划；"
            f"以已购人群为种子做相似拓展，定向 {purch_hint} 等高转化标签。",
            "- **自然端**：主图 / 标题 / 详情页对齐成交人群画像，替换低转化泛关键词为高转化精准词。",
            "- **验证指标**：新访画像向已购画像靠拢、新访支付转化率回升。",
            _tag_fix_marketing_line(ctx),
            "",
        ])

    new_hint = _profile_hint(ctx, "new_crowd")
    lines.extend([
        "#### 模块 1：客户新访转化优化",
        f"- **产品视觉**：围绕 {new_hint} 的审美与场景，强化主图 / 详情第一眼吸引力。",
        f"- **价格策略**：匹配 **{ctx.price_level}** 客群消费力，设置阶梯首单权益。",
        "- **品牌信任**：强化销量、评价、问大家与资质背书，降低首单决策顾虑。",
        _new_visitor_marketing_line(ctx),
        "- **付费拉新**：定向类目 / 竞品 / 场景兴趣人群；有投放时可勾选 **无界智惠券** 增益转化。",
        "",
        "#### 模块 2：未购客户回访承接优化",
        "- **货品承接**：搭建同品类梯度动销矩阵（价格 / 功能 / 场景梯度），匹配未购人群画像。",
        "- **召回策略**：按购买力与浏览行为分层召回，素材匹配用户首次浏览行为。",
        "- **承接落地**：回访专属权益 + 详情页信任背书，降低二次决策门槛。",
        _unpur_marketing_line(ctx),
        "",
        "#### 模块 3：已购客户回访复购优化",
        "- **同品类复购**：消耗品做周期购 / 补货提醒，耐用品做升级款 / 配件款延伸。",
        "- **跨品类延伸**：围绕核心客群兴趣标签拓展场景化关联品类。",
        "- **体系搭建**：会员权益、积分等级、专属触达通道，提升老客留存。",
        _purch_marketing_line(ctx),
    ])
    return lines


def _priority_rows(ctx: AnalysisContext) -> list[tuple[str, str, str, str]]:
    rows: list[tuple[str, str, str, str]] = []
    new = ctx.segments["new_crowd"]
    unpur = ctx.segments["unpur_crowd"]
    purch = ctx.segments["purch_crowd"]

    if ctx.match.overall_level == "严重不匹配":
        rows.append((
            "特级",
            "首单礼金 + 营销托管·新客",
            "crowd_match_level = 严重不匹配",
            "精准拉新修正人群标签，避免泛流量放大错位",
        ))

    if ctx.price_level == "低客单价":
        new_tool = "首单礼金 + 天天特卖"
    elif ctx.price_level == "中客单价":
        new_tool = "首单礼金 + 天猫 U 先"
    else:
        new_tool = "首单礼金 + 店铺 AI 红包"

    rows.append((
        "第一",
        new_tool,
        "新访拉新 / 首访转化阶段",
        "降低首单门槛，提升新访转化效率",
    ))

    if ctx.is_undertake_abnormal or (unpur.pay_rate or 0) < (new.pay_rate or 0):
        rows.append((
            "第一",
            "单品宝 + 店铺 AI 红包",
            "未购承接缺位 / 回访转化低于新访",
            "回访专属让利，激活未购二次成交",
        ))
    elif ctx.cycle_type in {"中长转化周期", "过渡型转化周期"}:
        rows.append((
            "第二",
            "超级立减 + 单品宝",
            ctx.cycle_type,
            "二次触达价格兜底，提升未购承接成交",
        ))

    if (new.pay_rate or 0) >= 0.05 and ctx.price_level != "低客单价":
        rows.append((
            "第二",
            "超级立减 + 广告智能跟投",
            "新访转化稳定、需放大日销",
            "日常转化维稳并放大高转化单品流量",
        ))

    if (purch.pay_rate or 0) <= 0.01 and purch.count > 0:
        rows.append((
            "第三",
            "老客礼金 + 店铺宝满减",
            "复购转化率接近零",
            "唤醒沉默老客，搭建复购基础链路",
        ))
    else:
        rows.append((
            "第三",
            "老客礼金 + 搭配宝",
            "已购回访规模 > 0",
            "提升复购率与连带客单",
        ))

    rows.append((
        "长期",
        "跨品类延伸 + 会员体系",
        "流量精准度合格、复购链路跑通后",
        "基于兴趣标签延伸，提升 LTV",
    ))
    return rows


def generate_conversion_analysis(result: SkillOutput) -> str:
    ctx = _build_context(result)
    total = ctx.total_customers or 1.0
    new = ctx.segments["new_crowd"]
    unpur = ctx.segments["unpur_crowd"]
    purch = ctx.segments["purch_crowd"]

    lines: list[str] = [
        f"# {SKILL_NAME}",
        "",
        f"统计周期：{ctx.stat_date}",
        f"画像区间：{ctx.profile_range or '—'}",
        "",
        "## 一、产品属性判定结论",
        "",
        f"1. 客单价层级：**{ctx.price_level}**（新访客单价 {_money(new.aov)}）",
        f"2. 转化周期类型：**{_cycle_type_text(ctx)}**",
        f"3. 核心运营逻辑：{ctx.core_operation_direction}",
        "",
        "## 二、人群画像匹配度诊断",
        "",
        "### 1. 核心维度偏差对比",
    ]

    for dim in ctx.match.dimensions:
        lines.append(f"- **{dim.name}（{dim.label}）**：{dim.summary}")

    lines.extend([
        "",
        f"### 2. 综合匹配度评级：**{ctx.match.overall_level}**",
        "",
        f"### 3. 根源问题判定",
        f"- {ctx.match.root_problem}",
        "",
        "## 三、全链路运营效率诊断",
        "",
        "### 1. 客流总览",
        f"- 店铺总客户数 {_count(total)}，{ctx.flow_status}。",
        f"- 结构占比：新访 {_pct(_share(new.count, total))}、"
        f"未购回访 {_pct(_share(unpur.count, total))}、"
        f"已购回访 {_pct(_share(purch.count, total))}。",
        f"- 结构判定：**{ctx.structure_type}**。",
        "",
        "### 2. 分人群效率拆解",
        "",
        "#### （1）客户新访",
        f"- {_new_segment_conclusion(ctx)}",
        "",
        "#### （2）未购客户回访",
        f"- {_unpur_segment_conclusion(ctx)}",
        "",
        "#### （3）已购客户回访",
        f"- {_purch_segment_conclusion(ctx)}",
        "",
        "### 3. 核心瓶颈总结",
    ])
    for index, item in enumerate(_bottlenecks(ctx), start=1):
        lines.append(f"{index}. **{item}**")

    lines.extend([
        "",
        "## 四、优化建议与落地优先级",
        "",
        "### 1. 分模块优化动作",
        "",
        *_module_actions(ctx),
        "",
        "### 2. 落地优先级总表",
        "",
        "| 优先级 | 优化方向 | 触发条件 | 核心目标 |",
        "| --- | --- | --- | --- |",
    ])
    for priority, direction, trigger, goal in _priority_rows(ctx):
        lines.append(f"| {priority} | {direction} | {trigger} | {goal} |")

    return "\n".join(lines)


def _count(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:,.0f}"


def _inline_md(text: str) -> str:
    escaped = html.escape(text)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)


def markdown_to_html(markdown_text: str) -> str:
    parts: list[str] = []
    in_ul = False
    in_ol = False
    in_table = False
    table_rows: list[str] = []

    def close_ul() -> None:
        nonlocal in_ul
        if in_ul:
            parts.append("</ul>")
            in_ul = False

    def close_ol() -> None:
        nonlocal in_ol
        if in_ol:
            parts.append("</ol>")
            in_ol = False

    def flush_table() -> None:
        nonlocal in_table, table_rows
        if not in_table:
            return
        if table_rows:
            head_cells = [f"<th>{_inline_md(cell.strip())}</th>" for cell in table_rows[0].strip("|").split("|")]
            body_rows: list[str] = []
            for row in table_rows[2:]:
                cells = [f"<td>{_inline_md(cell.strip())}</td>" for cell in row.strip("|").split("|")]
                body_rows.append(f"<tr>{''.join(cells)}</tr>")
            parts.append(
                f'<table class="ai-table"><thead><tr>{"".join(head_cells)}</tr></thead>'
                f'<tbody>{"".join(body_rows)}</tbody></table>'
            )
        table_rows = []
        in_table = False

    for raw_line in markdown_text.splitlines():
        line = raw_line.rstrip()
        if line.startswith("|"):
            close_ul()
            close_ol()
            if not in_table:
                in_table = True
                table_rows = []
            table_rows.append(line)
            continue
        flush_table()

        if not line.strip():
            close_ul()
            close_ol()
            continue
        if line.startswith("# "):
            close_ul()
            close_ol()
            parts.append(f'<h2 class="ai-h2">{_inline_md(line[2:].strip())}</h2>')
            continue
        if line.startswith("## "):
            close_ul()
            close_ol()
            parts.append(f'<h3 class="ai-h3">{_inline_md(line[3:].strip())}</h3>')
            continue
        if line.startswith("### "):
            close_ul()
            close_ol()
            parts.append(f'<h4 class="ai-h4">{_inline_md(line[4:].strip())}</h4>')
            continue
        if line.startswith("#### "):
            close_ul()
            close_ol()
            parts.append(f'<h5 class="ai-h5">{_inline_md(line[5:].strip())}</h5>')
            continue
        if line.startswith("> "):
            close_ul()
            close_ol()
            parts.append(f'<blockquote class="ai-quote">{_inline_md(line[2:].strip())}</blockquote>')
            continue
        if line.startswith("- "):
            close_ol()
            if not in_ul:
                parts.append('<ul class="ai-list">')
                in_ul = True
            parts.append(f"<li>{_inline_md(line[2:].strip())}</li>")
            continue
        if re.match(r"^\d+\.\s", line):
            close_ul()
            if not in_ol:
                parts.append('<ol class="ai-list ai-ol">')
                in_ol = True
            content = re.sub(r"^\d+\.\s*", "", line)
            parts.append(f"<li>{_inline_md(content.strip())}</li>")
            continue
        close_ul()
        close_ol()
        parts.append(f'<p class="ai-p">{_inline_md(line.strip())}</p>')

    close_ul()
    close_ol()
    flush_table()
    return "\n".join(parts)


def generate_conversion_analysis_html(result: SkillOutput) -> str:
    markdown_text = generate_conversion_analysis(result)
    body = markdown_to_html(markdown_text)
    return (
        f'<section id="ai-analysis" class="panel ai-analysis-panel">'
        f'<div class="ai-analysis-header">'
        f'<h2>AI 自动分析</h2>'
        f'<p class="muted">{html.escape(SKILL_NAME)}</p>'
        f'</div>'
        f'<div class="ai-analysis-body">{body}</div>'
        f'</section>'
    )
