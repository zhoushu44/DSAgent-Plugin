#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
细分需求裂变选品分析 —— 数据采集与整理入口。

流程：
  1. 解析输入（关键词 + 可选约束）
  2. 平台适配器采集（统一数据契约）
  3. 数据整理层：三层数据标记（原始/计算/AI判断）、词频统计、缺失提示
  4. 输出 __DSAGENT_RESULT__：数据摘要 + analysis_prompt（Agent 据此做六维拆解）

stdout 只输出 __DSAGENT_RESULT__{json}，进度走 stderr。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

# ─── runtime 引入 ───
_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

from runtime.dsagent_runtime import log, output_result  # noqa: E402

# 适配器注册表（多平台扩展点）
_here = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_here))
from adapters import get_adapter, AdapterError, CollectConstraints  # noqa: E402

# ─── 分析提示词（PDF SECTION 07 的框架，Agent 必须遵守）───
ANALYSIS_PROMPT_TEMPLATE = """你是一名电商需求分析助手。请基于下方采集到的关键词趋势、拓展词与商品数据，完成以下任务：

## 数据
- 平台：{platform}　关键词：「{keyword}」　采集时间：{collected_at}
- 拓展词 {n_words} 条（含搜索人气/环比/点击率/转化率）
- 商品样本 {n_products} 条（价格中位数 {price_median}，主价格带 {price_mode}）
- 价格分布：P10={p10} / P50={p50} / P90={p90}
{constraint_lines}
## 数据缺口（必须在报告中显式提示，不得用零值替代）
{gaps}

## 任务
1. 清洗标记：缺失、重复、异常数据不得当作有效值；
2. 六维拆解：人群、场景、功能、痛点、价格、竞争——每个维度给出数据依据（引用具体拓展词或商品特征）；
3. 趋势与周期：依据拓展词环比与商品销量分布，判断需求处于萌芽/上升/放量/成熟/衰退，说明依据；
4. 裂变方向：每个方向 = 核心需求 + 人群 + 场景 + 痛点 + 可验证商品形式；
   方向必须含：方向名称、目标人群、使用场景、需求依据、产品建议、竞争判断、验证动作、风险提示；
5. 分层：A 类（优先验证）/ B 类（观察测试）/ C 类（暂缓），每个方向给出分层理由；
6. 不得把推测描述成事实，不得承诺必然爆款；
7. 数据不足时明确说明需要补充哪些数据；
8. 先结论后依据，按固定报告结构输出（11 节：关键词概览/趋势判断/人群画像/需求拆解/商品方向/竞争分析/产品周期/切入建议/裂变方向/风险提示/一句话结论）。

## 参考数据摘录
拓展词 TOP20（按搜索人气）：
{top_words}

商品标题高频词 TOP30（人群/场景/功能线索）：
{title_tokens}

价格带分布：
{price_bands}
"""


def build_analysis_prompt(data: dict, constraints: CollectConstraints) -> str:
    """把采集数据填入分析提示词模板。"""
    words = data.get("keyword_trend") or []
    products = data.get("products") or []
    prices = [p["price"] for p in products if p.get("price", 0) > 0]
    price_median = sorted(prices)[len(prices) // 2] if prices else "—"
    pd = data.get("price_distribution") or {}

    top_words = sorted(words, key=lambda w: w.get("search_popularity", 0), reverse=True)[:20]
    words_lines = "\n".join(
        f"  {w['word']}（人气 {w['search_popularity']}，环比 {w.get('popularity_change') or '—'}，"
        f"点击率 {w.get('click_rate') or '—'}，转化率 {w.get('pay_conv_rate') or '—'}）"
        for w in top_words
    ) or "  （无拓展词数据）"

    tokens = _title_tokens(products)
    token_lines = "  " + "、".join(f"{t}({n})" for t, n in tokens) if tokens else "  （无商品数据）"

    bands = Counter()
    for p in prices:
        base = 10 ** len(str(int(p))) // 10 or 1
        lo = (int(p) // base) * base
        bands[f"{lo}-{lo + base}元"] += 1
    band_lines = "\n".join(f"  {b}: {n} 件" for b, n in bands.most_common(8)) or "  （无价格数据）"

    constraint_lines = ""
    if constraints.audience:
        constraint_lines += f"- 人群约束：{constraints.audience}\n"
    if constraints.scenario:
        constraint_lines += f"- 场景约束：{constraints.scenario}\n"
    if constraints.price_min is not None or constraints.price_max is not None:
        constraint_lines += f"- 价格带约束：{constraints.price_min or 0} ~ {constraints.price_max or '不限'} 元\n"

    gaps = "\n".join(f"- {g}" for g in data.get("data_gaps") or []) or "- 无已知缺口"

    return ANALYSIS_PROMPT_TEMPLATE.format(
        platform=data.get("platform", ""),
        keyword=data.get("keyword", ""),
        collected_at=data.get("collected_at", ""),
        n_words=len(words),
        n_products=len(products),
        price_median=price_median,
        price_mode=pd.get("mode_band", "—"),
        p10=pd.get("p10", "—"), p50=pd.get("p50", "—"), p90=pd.get("p90", "—"),
        constraint_lines=constraint_lines.rstrip() or "（无约束）",
        gaps=gaps,
        top_words=words_lines,
        title_tokens=token_lines,
        price_bands=band_lines,
    )


# ─── 标题词频（人群/场景/功能线索提取，计算数据）───
_STOP_TOKENS = {
    "的", "了", "和", "与", "及", "或", "等", "for", "新", "款", "专用", "正品",
    "官方", "旗舰店", "旗舰店同款", "包邮", "促销", "折扣", "特价", "热卖", "爆款",
}
_BRAND_HINTS = {"官方", "品牌", "直营"}


def _title_tokens(products: list[dict], top: int = 30) -> list[tuple[str, int]]:
    """商品标题词频：中文片段统计。

    长片段（≥3 字，如「大容量」「便携榨汁杯」）与 2 字词（如「充电」「户外」）
    分开统计后合并——2 字场景/功能词往往只出现一两次，恰是裂变信号，
    不能按频次阈值过滤；靠 top 截断控制总量。
    """
    long_counter: Counter[str] = Counter()
    bigram_counter: Counter[str] = Counter()
    for p in products:
        title = p.get("title") or ""
        for seg in re.findall(r"[\u4e00-\u9fa5]{3,8}|[A-Za-z0-9]+", title):
            if seg.lower() in _STOP_TOKENS:
                continue
            long_counter[seg] += 1
        for seg in re.findall(r"[\u4e00-\u9fa5]{2}", title):
            if seg in _STOP_TOKENS:
                continue
            bigram_counter[seg] += 1
    # 长片段优先（信息量高），2 字词按频次补齐到 top
    merged: list[tuple[str, int]] = list(long_counter.most_common(top))
    seen = {w for w, _ in merged}
    for w, n in bigram_counter.most_common(top * 2):
        if w not in seen:
            merged.append((w, n))
            seen.add(w)
        if len(merged) >= top:
            break
    return merged[:top]


def main() -> int:
    parser = argparse.ArgumentParser(description="细分需求裂变选品分析（采集+整理）")
    parser.add_argument("--keyword", "-k", required=True, help="核心关键词")
    parser.add_argument("--platform", "-p", default="taobao", help="目标平台（默认 taobao）")
    parser.add_argument("--audience", "-a", default="", help="目标人群约束")
    parser.add_argument("--scenario", "-s", default="", help="使用场景约束")
    parser.add_argument("--price-min", type=float, default=None, help="价格下限（元）")
    parser.add_argument("--price-max", type=float, default=None, help="价格上限（元）")
    parser.add_argument("--item-limit", type=int, default=120, help="商品采集数量（默认 120，上限 200）")
    parser.add_argument("--save", action="store_true", help="同时保存 JSON 到 artifacts/")
    args = parser.parse_args()

    args.item_limit = max(20, min(200, args.item_limit))

    log(f"细分需求分析：关键词「{args.keyword}」平台={args.platform}")
    log(f"约束：人群={args.audience or '不限'} 场景={args.scenario or '不限'} "
        f"价格={args.price_min or 0}~{args.price_max or '不限'}元 商品数≤{args.item_limit}")

    constraints = CollectConstraints(
        audience=args.audience, scenario=args.scenario,
        price_min=args.price_min, price_max=args.price_max,
        item_limit=args.item_limit,
    )

    # ─── 采集 ───
    try:
        adapter = get_adapter(args.platform)
        data = adapter.collect(args.keyword, constraints)
    except AdapterError as e:
        output_result({"ok": False, "failure_kind": e.failure_kind, "error": str(e)})
        return 1

    data_dict = data.to_dict()

    # ─── 整理层附加计算 ───
    data_dict["computed"] = {
        "title_tokens": _title_tokens(data_dict["products"], top=30),
        "tmall_ratio": (
            sum(1 for p in data_dict["products"] if p.get("is_tmall")) /
            max(1, len(data_dict["products"]))
        ),
        "data_layers": {
            "原始数据": "平台直采字段（拓展词指标、商品价格/销量/标题）",
            "计算数据": "价格分位、价格带众数、标题词频、天猫占比",
            "AI 判断": "报告中的六维拆解结论与裂变方向（由 Agent 生成）",
        },
    }

    # ─── 分析提示词 ───
    prompt = build_analysis_prompt(data_dict, constraints)

    # ─── 可选落盘 ───
    files: dict[str, str] = {}
    if args.save:
        ws = os.environ.get("DSAGENT_WORKSPACE") or os.getcwd()
        art = Path(ws) / "artifacts"
        art.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_kw = re.sub(r"[\\/:*?\"<>|\s]", "_", args.keyword)[:20]
        json_path = art / f"细分需求数据_{safe_kw}_{stamp}.json"
        json_path.write_text(
            json.dumps({"data": data_dict, "analysis_prompt": prompt},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        files["json"] = str(json_path)
        log(f"数据已保存: {json_path}")

    # ─── 输出 ───
    result = {
        "ok": True,
        "skill": "demand-niche-analysis",
        "platform": data_dict["platform"],
        "keyword": data_dict["keyword"],
        "data_summary": {
            "related_words": len(data_dict["keyword_trend"]),
            "products": len(data_dict["products"]),
            "price_median": data_dict["price_distribution"].get("p50"),
            "price_mode_band": data_dict["price_distribution"].get("mode_band"),
            "tmall_ratio": round(data_dict["computed"]["tmall_ratio"], 3),
        },
        "data_gaps": data_dict["data_gaps"],
        "analysis_prompt": prompt,
        "files": files,
    }
    output_result(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
