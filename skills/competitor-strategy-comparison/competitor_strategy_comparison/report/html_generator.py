"""竞品策略对比 HTML 可视化报告（参考浏览器样例布局）。"""

from __future__ import annotations

from html import escape
from pathlib import Path
from typing import Any

from ..parse import (
    active_scene_ids,
    audience_rows,
    channel_overview_row,
    channel_plan_rows,
    keyword_rows,
    metric_rows,
    opened_plans,
    promotion_rows,
    scene_name_map,
    strategy_rows,
)
from .insights import report_scope
from .layout_markdown import (
    md_block,
    render_advice_list,
    render_conclusion_list,
    render_diagnosis,
    split_sections,
)
from .layout_styles import REFERENCE_CSS


def generate_strategy_report(result: dict[str, Any], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_build_html(result), encoding="utf-8")
    return str(output_path)


def _build_html(result: dict[str, Any]) -> str:
    scope = report_scope(result)
    period = result.get("period") or {}
    start = period.get("start_date", "-")
    end = period.get("end_date", "-")
    days = period.get("day_count", "-")
    period_text = f"{start} 至 {end}"
    title = f"竞品策略对比报告：{scope['own_id']} vs {scope['competitor_id']}"

    body = "".join([
        _render_hero(scope, period_text, days),
        _render_scope_section(scope, period_text, days),
        _render_section("02", "经营结论", render_conclusion_list(result.get("insights_conclusion") or "")),
        _render_section("03", "核心经营数据", _render_metrics_section(result)),
        _render_section("04", "流量与成交诊断", _render_traffic_section(result)),
        _render_section("05", "人群经营数据与诊断", _render_audience_section(result)),
        _render_promotion_sections(result),
        _render_section("07", "投放计划明细", _render_plans_section(result)),
        _render_section("08", "双方 TOP 关键词", _render_keywords_section(result)),
        _render_section("09", "调整建议", render_advice_list(result.get("insights_recommendations") or "")),
        f'<footer>竞品策略对比报告 · 本品 {escape(scope["own_id"])} vs 竞品 {escape(scope["competitor_id"])} · {escape(period_text)}（{escape(str(days))} 天）</footer>',
    ])

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(title)}</title>
<style>{REFERENCE_CSS}</style>
</head>
<body>
<div class="wrap">
{body}
</div>
</body>
</html>"""


def _render_hero(scope: dict[str, str], period_text: str, days: Any) -> str:
    from datetime import datetime
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return f"""
<header class="hero">
  <div class="hero-top">
    <span class="eyebrow">达摩盘 · 竞品策略对比</span>
    <div class="generated-at">生成时间 {escape(generated_at)}</div>
  </div>
  <h1>竞品策略对比报告</h1>
  <div class="sub">经营核心指标 · 人群 · 推广渠道 · 投放计划 · TOP 关键词 全维度对比</div>
  <div class="meta-row">
    <div class="meta-chip"><b>本品：</b>{escape(scope["own_id"])}</div>
    <div class="meta-chip"><b>竞品：</b>{escape(scope["competitor_id"])}</div>
    <div class="meta-chip hl"><b>周期：</b>{escape(period_text)}</div>
    <div class="meta-chip"><b>天数：</b>{escape(str(days))} 个自然日</div>
    <div class="meta-chip"><b>口径：</b>仅代表本周期累计表现</div>
  </div>
</header>
"""


def _render_section(number: str, title: str, inner: str) -> str:
    return f"""
<section>
  <div class="card">
    <h2 class="sec-title">{escape(title)}<span class="sec-no">{escape(number)}</span></h2>
    {inner}
  </div>
</section>
"""


def _render_scope_section(scope: dict[str, str], period_text: str, days: Any) -> str:
    legend = """
<div class="vs-legend">
  <span class="lg"><span class="sw mine"></span>本品数据</span>
  <span class="lg"><span class="sw good"></span>领先/正向</span>
  <span class="lg"><span class="sw bad"></span>落后/风险</span>
</div>
"""
    return f"""
<section>
  <div class="card">
    <h2 class="sec-title">对比对象与周期<span class="sec-no">01</span></h2>
    <div class="obj-grid">
      <div class="obj-card mine">
        <span class="obj-tag mine">本品</span>
        <p class="obj-name">{escape(scope["own_name"])}</p>
        <div class="obj-id">商品 ID：{escape(scope["own_id"])}</div>
        {legend}
      </div>
      <div class="obj-card rival">
        <span class="obj-tag rival">竞品</span>
        <p class="obj-name">{escape(scope["competitor_name"])}</p>
        <div class="obj-id">商品 ID：{escape(scope["competitor_id"])}</div>
        {legend.replace("本品数据", "竞品数据").replace("sw mine", "sw rival")}
      </div>
    </div>
    <p class="footnote" style="margin-top:12px;">分析周期：{escape(period_text)}（{escape(str(days))} 个自然日）。本报告所有结论仅代表该周期内的累计表现，不代表更早或更晚周期的投放历史。竞品数据按平台规则存在模糊区间，均保留原值展示，不做中点估算。</p>
  </div>
</section>
"""


def _diff_badge(value: str) -> tuple[str, str]:
    text = str(value or "").strip()
    if text.startswith("+"):
        return "up", text
    if text.startswith("-"):
        return "down", text
    return "neu", text if text and text != "-" else "—"


def _diff_cell(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("+"):
        return f'<td class="num diff-up"><i class="arrow">▲</i> {escape(text)}</td>'
    if text.startswith("-"):
        return f'<td class="num diff-down"><i class="arrow">▼</i> {escape(text)}</td>'
    if text and text != "-":
        return f'<td class="num diff-neu"><i class="arrow">—</i> {escape(text)}</td>'
    return '<td class="num diff-neu">—</td>'


def _render_metrics_section(result: dict[str, Any]) -> str:
    rows = metric_rows(result.get("key_metrics"))
    if not rows:
        return '<div class="no-data">本周期未返回可确认的核心经营数据</div>'

    kpis: list[str] = []
    for label, own, competitor, diff in rows:
        cls, badge = _diff_badge(diff)
        kpis.append(
            '<div class="kpi">'
            f'<div class="k-name">{escape(label)} <span class="k-diff {cls}">{escape(badge)}</span></div>'
            '<div class="k-values">'
            f'<div class="kv"><span class="who mine">本品</span><span class="val mine">{escape(own)}</span></div>'
            f'<div class="kv"><span class="who rival">竞品</span><span class="val rival">{escape(competitor)}</span></div>'
            "</div></div>"
        )

    table_rows = "".join(
        f"<tr><td>{escape(label)}</td>"
        f'<td class="num c-mine">{escape(own)}</td>'
        f'<td class="num c-rival">{escape(competitor)}</td>'
        f"{_diff_cell(diff)}</tr>"
        for label, own, competitor, diff in rows
    )

    return (
        f'<div class="kpi-grid">{"".join(kpis)}</div>'
        '<div class="tbl-wrap"><table>'
        "<thead><tr><th>指标</th><th class=\"num\">本品</th><th class=\"num\">竞品</th><th class=\"num\">差异（本品相对竞品）</th></tr></thead>"
        f"<tbody>{table_rows}</tbody></table></div>"
        '<p class="footnote">成交金额按「成交订单数 × 单价」计算。竞品部分指标为平台区间化数据，保留原区间。差异颜色仅作方向提示。</p>'
    )


def _render_traffic_section(result: dict[str, Any]) -> str:
    rows = metric_rows(result.get("key_metrics"))
    lookup = {row[0]: row for row in rows}
    traffic_rows: list[tuple[str, str, str, str]] = []
    if "浏览量" in lookup:
        label, own, comp, _ = lookup["浏览量"]
        traffic_rows.append(("流量规模", own, comp, "浏览量规模对比，反映双方流量入口差距。"))
    paid = lookup.get("付费点击量")
    free = lookup.get("免费点击量")
    if paid and free:
        traffic_rows.append((
            "流量结构",
            f"免费 {free[1]} / 付费 {paid[1]}",
            f"免费 {free[2]} / 付费 {paid[2]}",
            "对比免费与付费流量结构，判断更依赖自然流量还是付费拉新。",
        ))
    if "支付转化率" in lookup:
        _, own, comp, _ = lookup["支付转化率"]
        traffic_rows.append(("转化效率", own, comp, "支付转化率反映流量承接与成交效率。"))
    if "单价" in lookup and "成交金额" in lookup:
        _, own_p, comp_p, _ = lookup["单价"]
        _, own_a, comp_a, _ = lookup["成交金额"]
        traffic_rows.append((
            "价格与成交",
            f"单价 {own_p}<br>成交金额 {own_a}",
            f"单价 {comp_p}<br>成交金额 {comp_a}",
            "结合单价与成交金额，观察客单与规模对总成交的影响。",
        ))

    table = ""
    if traffic_rows:
        body = "".join(
            f"<tr><td>{escape(dim)}</td><td class=\"num c-mine\">{own}</td><td class=\"num c-rival\">{comp}</td><td>{escape(note)}</td></tr>"
            for dim, own, comp, note in traffic_rows
        )
        table = (
            '<div class="tbl-wrap"><table>'
            '<thead><tr><th style="width:110px;">维度</th><th class="num">本品</th><th class="num">竞品</th><th>解读</th></tr></thead>'
            f"<tbody>{body}</tbody></table></div>"
        )

    diagnosis = render_diagnosis(result.get("insights_traffic") or "", css_class="blue")
    return table + diagnosis if table or diagnosis else '<div class="no-data">本周期暂无流量与成交诊断</div>'


def _render_audience_section(result: dict[str, Any]) -> str:
    rows = audience_rows(result.get("audience_comparison"))
    if not rows:
        table = '<div class="no-data">本周期未返回可确认的人群数据</div>'
    else:
        body = "".join(
            "<tr>"
            f"<td>{escape(row[0])}</td>"
            f'<td class="num c-mine">{escape(row[1])}</td><td class="num c-rival">{escape(row[2])}</td>'
            f'<td class="num c-mine">{escape(row[3])}</td><td class="num c-rival">{escape(row[4])}</td>'
            f'<td class="num c-mine">{escape(row[5])}</td><td class="num c-rival">{escape(row[6])}</td>'
            f'<td class="num c-mine">{escape(row[7])}</td><td class="num c-rival">{escape(row[8])}</td>'
            "</tr>"
            for row in rows
        )
        table = (
            '<div class="tbl-wrap"><table>'
            "<thead>"
            '<tr><th rowspan="2">人群类型</th>'
            '<th colspan="2" class="group-mine">人数</th>'
            '<th colspan="2" class="group-mine">成交订单数</th>'
            '<th colspan="2" class="group-mine">支付转化率</th>'
            '<th colspan="2" class="group-mine">收藏加购率</th></tr>'
            "<tr>"
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            "</tr></thead>"
            f"<tbody>{body}</tbody></table></div>"
        )

    diagnosis_md = result.get("insights_audience") or ""
    diagnosis = ""
    if diagnosis_md.strip():
        diagnosis = '<h3 class="block-title">人群诊断</h3>' + render_conclusion_list(diagnosis_md)
    return table + diagnosis


def _channel_kind(name: str) -> tuple[str, str, str]:
    if "关键词" in name:
        return "kw", "kw", "关键词"
    if "人群" in name:
        return "aud", "aud", "人群"
    if "全站" in name or "货品" in name:
        return "whole", "whole", "货品"
    return "other", "other", name[:2]


def _scene_tag(name: str) -> str:
    kind, css, _ = _channel_kind(name)
    return f'<span class="tag {"blue" if kind == "kw" else "orange" if kind == "aud" else "gray"}">{escape(name)}</span>'


def _render_promotion_sections(result: dict[str, Any]) -> str:
    promotion = result.get("promotion_strategy")
    overview = promotion_rows(promotion)
    promotion_md = result.get("insights_promotion") or ""
    channel_judges = split_sections(promotion_md)

    overview_html = ""
    if overview:
        body = "".join(
            f"<tr><td>{_scene_tag(row[0])}</td>"
            f'<td class="num c-mine">{escape(row[1])}</td><td class="num c-rival">{escape(row[2])}</td>'
            f'<td class="num c-mine">{escape(row[3])}</td><td class="num c-rival">{escape(row[4])}</td>'
            f'<td class="num c-mine">{escape(row[5])}</td><td class="num c-rival">{escape(row[6])}</td>'
            f'<td class="num c-mine">{escape(row[7])}</td><td class="num c-rival">{escape(row[8])}</td>'
            "</tr>"
            for row in overview
        )
        overview_html = (
            '<p style="margin:0 0 6px; font-size:13px; color:var(--muted);">一级推广场景总览（消耗占比为该场景占本方总消耗的比例）：</p>'
            '<div class="tbl-wrap"><table>'
            "<thead>"
            "<tr><th>推广场景</th>"
            '<th colspan="2" class="group-mine">消耗</th>'
            '<th colspan="2" class="group-mine">消耗占比</th>'
            '<th colspan="2" class="group-mine">点击率</th>'
            '<th colspan="2" class="group-mine">直接 ROI</th></tr>'
            "<tr><th></th>"
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            '<th class="num group-mine">本品</th><th class="num group-rival">竞品</th>'
            "</tr></thead>"
            f"<tbody>{body}</tbody></table></div>"
        )
    elif not active_scene_ids(promotion):
        return _render_section("06", "推广渠道数据与诊断", '<div class="no-data">本周期未返回可确认的推广渠道数据</div>')

    channels: list[str] = []
    names = scene_name_map(promotion)
    for scene_id in active_scene_ids(promotion):
        scene_name = names.get(str(scene_id), str(scene_id))
        overview_row = channel_overview_row(promotion, scene_id) or {}
        _, badge_cls, _ = _channel_kind(scene_name)
        own_rows = channel_plan_rows(promotion, scene_id, "own")
        rival_rows = channel_plan_rows(promotion, scene_id, "competitor")
        judge = channel_judges.get(scene_name) or channel_judges.get(scene_name.replace("推广", "")) or ""

        overview_table = ""
        if overview_row:
            metrics = [
                ("消耗", "own_charge", "competitor_charge"),
                ("消耗占比", "own_ratio", "competitor_ratio"),
                ("点击率", "own_ctr", "competitor_ctr"),
                ("点击成本", "own_cpc", "competitor_cpc"),
                ("直接成交金额", "own_deal", "competitor_deal"),
                ("直接 ROI", "own_roi", "competitor_roi"),
            ]
            ob = "".join(
                f"<tr><td>{escape(label)}</td>"
                f'<td class="num c-mine">{escape(overview_row.get(own_k, "-"))}</td>'
                f'<td class="num c-rival">{escape(overview_row.get(comp_k, "-"))}</td></tr>'
                for label, own_k, comp_k in metrics
            )
            overview_table = (
                '<h4 style="margin:6px 0 4px; font-size:13px; color:var(--muted);">渠道概览对比</h4>'
                '<div class="tbl-wrap"><table style="min-width:520px;">'
                '<thead><tr><th>指标</th><th class="num group-mine">本品</th><th class="num group-rival">竞品</th></tr></thead>'
                f"<tbody>{ob}</tbody></table></div>"
            )

        channels.append(
            f'<div class="channel">'
            f'<div class="channel-head"><span class="channel-badge {badge_cls}">{escape(scene_name[:4])}</span><h3>{escape(scene_name)}</h3></div>'
            f'{overview_table}'
            '<div class="split-grid">'
            f'<div class="plan-block"><h4><span class="dot mine"></span>本品投放方案</h4>{_render_plan_table(own_rows, side="own")}</div>'
            f'<div class="plan-block"><h4><span class="dot rival"></span>竞品投放方案</h4>{_render_plan_table(rival_rows, side="rival")}</div>'
            "</div>"
            + (f'<div class="judge">{md_block(judge)}</div>' if judge else "")
            + "</div>"
        )

    inner = overview_html + "".join(channels)
    if promotion_md.strip() and not channel_judges:
        inner += render_diagnosis(promotion_md)
    return f"""
<section>
  <div class="card">
    <h2 class="sec-title">推广渠道数据与诊断<span class="sec-no">06</span></h2>
    {inner}
  </div>
</section>
"""


def _render_plan_table(rows: list[list[str]], *, side: str) -> str:
    if not rows:
        return '<div class="no-data">本周期未返回可确认的投放方案</div>'
    body = "".join(
        "<tr>"
        f"<td>{escape(row[0])}</td>"
        f'<td class="num">{escape(row[1])}</td>'
        f'<td class="num">{escape(row[2])}</td>'
        f'<td class="num">{escape(row[3])}</td>'
        f'<td class="num">{escape(row[4])}</td>'
        f'<td class="num">{escape(row[5])}</td>'
        f'<td class="num">{escape(row[6])}</td>'
        f'<td class="num">{escape(row[7])}</td>'
        "</tr>"
        for row in rows
    )
    return (
        '<div class="tbl-wrap"><table>'
        "<thead><tr><th>投放方案</th><th class=\"num\">展现</th><th class=\"num\">点击</th>"
        "<th class=\"num\">点击率</th><th class=\"num\">消耗</th><th class=\"num\">点击成本</th>"
        "<th class=\"num\">直接成交</th><th class=\"num\">直接ROI</th></tr></thead>"
        f"<tbody>{body}</tbody></table></div>"
    )


def _render_plans_section(result: dict[str, Any]) -> str:
    promotion = result.get("promotion_strategy")
    scene_ids = active_scene_ids(promotion)
    names = scene_name_map(promotion)
    if not scene_ids:
        return '<div class="no-data">本周期未返回可确认的投放计划明细</div>'

    detail_rows: list[str] = []
    for scene_id in scene_ids:
        scene_name = names.get(str(scene_id), str(scene_id))
        _, ch_cls, ch_short = _channel_kind(scene_name)
        for row in channel_plan_rows(promotion, scene_id, "own"):
            rival = next((r for r in channel_plan_rows(promotion, scene_id, "competitor") if r[0] == row[0]), None)
            detail_rows.append(
                "<tr>"
                f'<td><span class="ch-tag {ch_cls}">{escape(scene_name)}</span></td>'
                f"<td>{escape(row[0])}</td>"
                f'<td class="num c-mine">{escape(row[4])}</td><td class="num c-mine">{escape(row[6])}</td><td class="num c-mine">{escape(row[7])}</td>'
                f'<td class="num c-rival">{escape(rival[4]) if rival else "-"}</td>'
                f'<td class="num c-rival">{escape(rival[6]) if rival else "-"}</td>'
                f'<td class="num c-rival">{escape(rival[7]) if rival else "-"}</td>'
                "</tr>"
            )
        for row in channel_plan_rows(promotion, scene_id, "competitor"):
            if any(r[0] == row[0] for r in channel_plan_rows(promotion, scene_id, "own")):
                continue
            detail_rows.append(
                "<tr>"
                f'<td><span class="ch-tag {ch_cls}">{escape(scene_name)}</span></td>'
                f"<td>{escape(row[0])}</td>"
                f'<td class="num c-mine">本周期未返回</td><td class="num c-mine">-</td><td class="num c-mine">-</td>'
                f'<td class="num c-rival">{escape(row[4])}</td><td class="num c-rival">{escape(row[6])}</td><td class="num c-rival">{escape(row[7])}</td>'
                "</tr>"
            )

    table = ""
    if detail_rows:
        table = (
            '<p style="margin:0 0 6px; font-size:13px; color:var(--muted);">本周期有数据场景下的全部投放方案及双方累计效果：</p>'
            '<div class="tbl-wrap"><table>'
            "<thead><tr>"
            "<th>推广场景</th><th>投放方案</th>"
            '<th class="num group-mine">本品消耗</th><th class="num group-mine">本品直接成交</th><th class="num group-mine">本品直接ROI</th>'
            '<th class="num group-rival">竞品消耗</th><th class="num group-rival">竞品直接成交</th><th class="num group-rival">竞品直接ROI</th>'
            "</tr></thead>"
            f"<tbody>{''.join(detail_rows)}</tbody></table></div>"
        )

    own_plans = opened_plans(promotion, "own")
    rival_plans = opened_plans(promotion, "competitor")

    def plan_items(plans: list[str], side: str) -> str:
        if not plans:
            return '<li>本周期未返回可确认的计划</li>'
        items = []
        for plan in plans:
            scene = next((names.get(sid, sid) for sid in scene_ids if plan in str(strategy_rows(promotion))), "")
            _, ch_cls, ch_short = _channel_kind(str(scene))
            items.append(f'<li><span class="ch-tag {ch_cls}">{escape(ch_short)}</span>{escape(plan)}</li>')
        return "".join(items)

    summary = (
        '<div class="split-grid" style="margin-top:16px;">'
        f'<div class="plan-block"><h4><span class="dot mine"></span>本品实际开启的计划</h4><ul class="plan-list">{plan_items(own_plans, "own")}</ul></div>'
        f'<div class="plan-block"><h4><span class="dot rival"></span>竞品实际开启的计划</h4><ul class="plan-list">{plan_items(rival_plans, "rival")}</ul></div>'
        "</div>"
    )
    return (table or '<div class="no-data">本周期未返回可确认的投放计划明细</div>') + summary


def _render_keywords_section(result: dict[str, Any]) -> str:
    promotion = result.get("promotion_strategy")
    own_rows = keyword_rows(promotion, "own")
    rival_rows = keyword_rows(promotion, "competitor")

    def kw_table(rows: list[list[str]]) -> str:
        if not rows:
            return '<div class="no-data">本周期未返回可确认的 TOP 关键词</div>'
        body = "".join(
            "<tr>"
            f"<td>{escape(row[0])}</td>"
            f'<td><span class="tag blue">{escape(row[1])}</span></td>'
            f'<td class="num">{escape(row[2])}</td><td class="num">{escape(row[3])}</td>'
            f'<td class="num">{escape(row[4])}</td><td class="num">{escape(row[5])}</td>'
            "</tr>"
            for row in rows
        )
        return (
            '<div class="tbl-wrap"><table style="min-width:480px;">'
            "<thead><tr><th>关键词</th><th>词类型</th><th class=\"num\">展现</th><th class=\"num\">点击</th>"
            "<th class=\"num\">点击率</th><th class=\"num\">转化率</th></tr></thead>"
            f"<tbody>{body}</tbody></table></div>"
        )

    diagnosis = ""
    if (result.get("insights_keywords") or "").strip():
        diagnosis = '<h3 class="block-title">关键词诊断</h3>' + render_conclusion_list(result.get("insights_keywords") or "")

    if not own_rows and not rival_rows and not diagnosis:
        return '<div class="no-data">本周期未返回可确认的 TOP 关键词</div>'

    return (
        '<div class="split-grid">'
        f'<div class="plan-block"><h4><span class="dot mine"></span>本品 TOP 关键词</h4>{kw_table(own_rows)}</div>'
        f'<div class="plan-block"><h4><span class="dot rival"></span>竞品 TOP 关键词</h4>{kw_table(rival_rows)}</div>'
        "</div>"
        + diagnosis
    )
