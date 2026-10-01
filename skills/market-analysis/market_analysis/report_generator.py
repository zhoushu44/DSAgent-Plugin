from __future__ import annotations

from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any, Iterable

from .types import SkillOutput

TRAIT_TYPE_LABEL_MAP = {
    "shop_type": "店铺类型",
    "price_bucket": "到手价带",
    "original_price_bucket": "原价带",
    "coupon_bucket": "优惠金额",
    "location_province": "发货省份",
    "activity_tag": "活动标签",
    "location": "发货地",
    "activity_flag": "活动情况",
    "p4p_flag": "推广标记",
}

PRODUCT_FIELD_LABEL_MAP = {
    "item_id": "商品ID",
    "title": "商品标题",
    "main_image": "主图链接",
    "price": "价格",
    "original_price": "原价",
    "current_price": "当前价",
    "price_unit": "价格单位",
    "sales": "销量文本",
    "sales_count": "销量数值",
    "same_count": "同款商品数",
    "shop_name": "店铺名称",
    "shop_title": "店铺标题",
    "shop_link": "店铺链接",
    "is_tmall": "是否天猫",
    "location": "发货地",
    "product_link": "商品链接",
    "activity_tag": "活动标签",
    "category_id": "类目ID",
    "is_p4p": "是否推广商品",
    "page": "页码",
    "page_rank": "页内排名",
    "global_rank": "全局排名",
}


def generate_market_analysis_report(result: SkillOutput, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(_build_html(result), encoding="utf-8")
    return str(output_path)


def _build_html(result: SkillOutput) -> str:
    analysis = result.analysis or {}
    overview = analysis.get("overview", {})
    distributions = analysis.get("distributions", {})
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    front_sample_size = overview.get("front_sample_size", 0)

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(result.keyword)} 淘宝商品市场分析报告</title>
  <style>
    :root {{
      --bg: #eef4fb;
      --bg-deep: #e3edf8;
      --panel: rgba(255, 255, 255, 0.94);
      --panel-strong: #ffffff;
      --line: #d4e2f0;
      --text: #1e293b;
      --muted: #64748b;
      --accent: #2563eb;
      --accent-strong: #1d4ed8;
      --accent-soft: #dbeafe;
      --chip: #f1f6fc;
      --good: #0284c7;
      --shadow: 0 18px 48px rgba(30, 64, 120, 0.08);
    }}
    * {{
      box-sizing: border-box;
    }}
    html, body {{
      margin: 0;
      overflow-x: hidden;
    }}
    body {{
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 24%),
        radial-gradient(circle at right 12%, rgba(147, 197, 253, 0.2), transparent 18%),
        linear-gradient(180deg, #f8fbff 0%, var(--bg) 46%, var(--bg-deep) 100%);
      color: var(--text);
      font: 14px/1.65 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }}
    .page {{
      width: min(1680px, calc(100vw - 28px));
      margin: 0 auto;
      padding: clamp(16px, 2.4vw, 34px) 0 42px;
    }}
    .hero,
    .panel,
    .card {{
      border: 1px solid rgba(212, 226, 240, 0.95);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }}
    .hero {{
      padding: clamp(18px, 3vw, 30px);
      position: relative;
      overflow: hidden;
    }}
    .hero::after {{
      content: "";
      position: absolute;
      inset: auto -60px -80px auto;
      width: 220px;
      height: 220px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(37, 99, 235, 0.16), transparent 66%);
      pointer-events: none;
    }}
    .eyebrow {{
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-strong);
      font-size: 12px;
      letter-spacing: 0.06em;
    }}
    h1, h2, h3 {{
      font-family: "Iowan Old Style", "Noto Serif SC", "Songti SC", "STSong", serif;
      letter-spacing: 0.01em;
    }}
    h1 {{
      margin: 14px 0 10px;
      font-size: clamp(30px, 4.5vw, 48px);
      line-height: 1.08;
    }}
    h2 {{
      margin: 0;
      font-size: clamp(22px, 2.2vw, 30px);
      line-height: 1.2;
    }}
    h3 {{
      margin: 0;
      font-size: 18px;
      line-height: 1.25;
    }}
    p {{
      margin: 0;
      color: var(--muted);
    }}
    .hero-copy {{
      max-width: 960px;
    }}
    .meta {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 22px;
    }}
    .meta-item,
    .card {{
      min-width: 0;
    }}
    .meta-item {{
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.88);
      border: 1px solid rgba(212, 226, 240, 0.95);
    }}
    .meta-item strong {{
      display: block;
      margin-top: 8px;
      color: var(--text);
      font-size: 16px;
      font-weight: 600;
      word-break: break-word;
    }}
    .card-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }}
    .card {{
      padding: 18px;
    }}
    .card strong {{
      display: block;
      margin-top: 10px;
      font-size: clamp(24px, 3vw, 34px);
      line-height: 1.1;
      color: var(--text);
    }}
    .sections {{
      display: grid;
      gap: 18px;
      margin-top: 18px;
    }}
    .panel {{
      padding: clamp(18px, 2.4vw, 28px);
      overflow: hidden;
    }}
    .section-head {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }}
    .section-kicker {{
      display: inline-block;
      margin-bottom: 8px;
      color: var(--accent-strong);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .tag-row {{
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }}
    .tag {{
      display: inline-flex;
      align-items: center;
      padding: 5px 11px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent-strong);
      font-size: 12px;
      line-height: 1.2;
    }}
    .insight-list {{
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 12px;
    }}
    .insight-list li {{
      padding: 14px 16px;
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(241, 246, 252, 0.9));
      border: 1px solid rgba(212, 226, 240, 0.95);
      color: var(--text);
    }}
    .tab-group {{
      position: relative;
    }}
    .tab-group input {{
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }}
    .tab-controls {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }}
    .tab-controls label {{
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 46px;
      padding: 10px 12px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.82);
      color: var(--muted);
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: 180ms ease;
    }}
    .tab-controls label:hover {{
      border-color: rgba(37, 99, 235, 0.4);
      color: var(--accent-strong);
    }}
    #tab-terms:checked ~ .tab-controls label[for="tab-terms"],
    #tab-front-terms:checked ~ .tab-controls label[for="tab-front-terms"],
    #tab-traits:checked ~ .tab-controls label[for="tab-traits"],
    #tab-distributions:checked ~ .tab-controls label[for="tab-distributions"] {{
      background: linear-gradient(180deg, #3b82f6, #2563eb);
      border-color: rgba(29, 78, 216, 0.92);
      color: #f8fbff;
      box-shadow: 0 10px 22px rgba(37, 99, 235, 0.22);
      transform: translateY(-1px);
    }}
    .tab-panel {{
      display: none;
      padding: 18px;
      border-radius: 20px;
      border: 1px solid rgba(212, 226, 240, 0.95);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(241, 246, 252, 0.92));
    }}
    #tab-terms:checked ~ .tab-panels .panel-terms,
    #tab-front-terms:checked ~ .tab-panels .panel-front-terms,
    #tab-traits:checked ~ .tab-panels .panel-traits,
    #tab-distributions:checked ~ .tab-panels .panel-distributions {{
      display: block;
    }}
    .panel-note {{
      margin-top: 6px;
      margin-bottom: 18px;
    }}
    .chips {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }}
    .chip {{
      min-width: 0;
      padding: 12px 13px;
      border-radius: 16px;
      background: var(--chip);
      border: 1px solid rgba(212, 226, 240, 0.95);
    }}
    .chip strong {{
      display: block;
      margin-bottom: 6px;
      color: var(--text);
      font-size: 15px;
      line-height: 1.3;
      word-break: break-word;
    }}
    .chip span {{
      display: block;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }}
    .trait-grid,
    .distribution-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
    }}
    .trait-card,
    .distribution-card {{
      min-width: 0;
      padding: 16px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(212, 226, 240, 0.95);
    }}
    .trait-card strong,
    .distribution-card strong {{
      display: block;
      color: var(--text);
      font-size: 16px;
      line-height: 1.35;
      word-break: break-word;
    }}
    .trait-type {{
      display: inline-flex;
      align-items: center;
      margin-bottom: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(219, 234, 254, 0.92);
      color: var(--accent-strong);
      font-size: 12px;
    }}
    .trait-metrics {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }}
    .metric-box {{
      min-width: 0;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(241, 246, 252, 0.92);
    }}
    .metric-box span {{
      display: block;
      color: var(--muted);
      font-size: 12px;
    }}
    .metric-box b {{
      display: block;
      margin-top: 5px;
      color: var(--text);
      font-size: 16px;
    }}
    .accent {{
      color: var(--good);
    }}
    .distribution-list {{
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }}
    .distribution-item {{
      display: grid;
      gap: 7px;
    }}
    .distribution-topline {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
    }}
    .distribution-topline span:first-child {{
      min-width: 0;
      color: var(--text);
      word-break: break-word;
    }}
    .distribution-topline span:last-child {{
      flex-shrink: 0;
      color: var(--muted);
      white-space: nowrap;
    }}
    .distribution-bar {{
      width: 100%;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(212, 226, 240, 0.85);
    }}
    .distribution-bar i {{
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #60a5fa, #2563eb);
    }}
    .detail-scroll {{
      margin-top: 14px;
      max-height: 560px;
      overflow: auto;
      border-radius: 18px;
      border: 1px solid rgba(212, 226, 240, 0.95);
      background: rgba(255, 255, 255, 0.96);
    }}
    .detail-table {{
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      line-height: 1.45;
    }}
    .detail-table th,
    .detail-table td {{
      padding: 10px 12px;
      border-bottom: 1px solid rgba(226, 236, 248, 0.95);
      text-align: left;
      vertical-align: top;
    }}
    .detail-table th {{
      position: sticky;
      top: 0;
      z-index: 2;
      background: #e8f1fc;
      color: #475569;
      font-weight: 600;
      white-space: nowrap;
    }}
    .detail-table tbody tr:nth-child(even) {{
      background: rgba(241, 246, 252, 0.65);
    }}
    .detail-table td {{
      max-width: 220px;
      word-break: break-word;
      overflow: visible;
    }}
    .detail-cell {{
      position: relative;
      min-width: 0;
    }}
    .detail-cell-preview {{
      display: -webkit-box;
      max-height: calc(1.45em * 5);
      overflow: hidden;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      word-break: break-all;
    }}
    .detail-cell-hover {{
      display: none;
      position: absolute;
      left: 0;
      top: calc(100% + 6px);
      z-index: 20;
      width: min(420px, 72vw);
      max-height: 240px;
      padding: 10px 12px;
      overflow: auto;
      border-radius: 14px;
      border: 1px solid rgba(37, 99, 235, 0.22);
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 16px 34px rgba(30, 64, 120, 0.14);
      color: var(--text);
      word-break: break-all;
      white-space: pre-wrap;
      backdrop-filter: blur(8px);
    }}
    .detail-cell:hover .detail-cell-hover,
    .detail-cell:focus-within .detail-cell-hover {{
      display: block;
    }}
    .detail-content-link,
    .detail-cell-hover a {{
      color: var(--accent-strong);
      text-decoration: none;
      word-break: break-all;
    }}
    .detail-content-link:hover,
    .detail-cell-hover a:hover {{
      text-decoration: underline;
    }}
    .muted {{
      color: var(--muted);
    }}
    .footnote {{
      margin-top: 14px;
      font-size: 12px;
      color: var(--muted);
    }}
    @media (max-width: 920px) {{
      .page {{
        width: min(100vw - 18px, 100%);
      }}
      .panel,
      .hero,
      .card {{
        border-radius: 20px;
      }}
    }}
    @media (max-width: 640px) {{
      .page {{
        width: calc(100vw - 14px);
        padding-top: 10px;
      }}
      .hero,
      .panel,
      .card {{
        padding-left: 16px;
        padding-right: 16px;
        border-radius: 18px;
      }}
      .card-grid {{
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }}
      .trait-metrics {{
        grid-template-columns: 1fr;
      }}
      .detail-scroll {{
        max-height: 480px;
      }}
    }}
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <span class="eyebrow">淘宝商品市场分析报告</span>
      <div class="hero-copy">
        <h1>{escape(result.keyword)}</h1>
        <p>原始输入：{escape(result.raw_query)}。本报告只基于本次实际获取到的商品样本进行统计，不补全、不虚构。</p>
      </div>
      <div class="meta">
        <div class="meta-item"><span class="muted">生成时间</span><strong>{escape(generated_at)}</strong></div>
        <div class="meta-item"><span class="muted">排序方式</span><strong>{escape(str(result.requested_config.get("sort_label", "")))}</strong></div>
        <div class="meta-item"><span class="muted">发货地</span><strong>{escape(str(result.requested_config.get("location") or "不限"))}</strong></div>
      </div>
    </section>

    <section class="card-grid">
      {_render_stat_card("总商品数", _format_plain_number(overview.get("total_results", 0)))}
      {_render_stat_card("实际分析样本", _format_plain_number(overview.get("sampled_products", 0)))}
      {_render_stat_card("分析店铺数", _format_plain_number(overview.get("unique_shops", 0)))}
      {_render_stat_card("前排对比样本", f"前{_format_plain_number(front_sample_size)}名")}
      {_render_stat_card("价格中位数", f"{_format_number(overview.get('price', {}).get('median', 0))} 元")}
      {_render_stat_card("销量中位数", _format_plain_number(overview.get("sales", {}).get("median", 0)))}
    </section>

    <div class="sections">
      <section class="panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Summary</span>
            <h2>分析结论</h2>
          </div>
          <div class="tag-row">
            <span class="tag">仅基于本次样本</span>
            <span class="tag">前排样本前 {escape(_format_plain_number(front_sample_size))} 名</span>
          </div>
        </div>
        {_render_insights(analysis.get("insights", []))}
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Insights</span>
            <h2>数据洞察</h2>
          </div>
          <div class="tag-row">
            <span class="tag">单页切换查看</span>
          </div>
        </div>
        <div class="tab-group">
          <input id="tab-terms" type="radio" name="analysis-tab" checked>
          <input id="tab-front-terms" type="radio" name="analysis-tab">
          <input id="tab-traits" type="radio" name="analysis-tab">
          <input id="tab-distributions" type="radio" name="analysis-tab">

          <div class="tab-controls">
            <label for="tab-terms">标题高频词</label>
            <label for="tab-front-terms">前排标题词</label>
            <label for="tab-traits">前排共性</label>
            <label for="tab-distributions">分布概览</label>
          </div>

          <div class="tab-panels">
            <section class="tab-panel panel-terms">
              <div class="section-head">
                <div>
                  <span class="section-kicker">Keyword Density</span>
                  <h3>标题高频词</h3>
                </div>
              </div>
              <p class="panel-note">展示当前样本里标题中重复出现较多的词，用来帮助判断搜索页主流卖点。</p>
              {_render_chips(
                  analysis.get("high_frequency_terms", []),
                  count_key="title_count",
                  coverage_key="coverage",
              )}
            </section>

            <section class="tab-panel panel-front-terms">
              <div class="section-head">
                <div>
                  <span class="section-kicker">Front Rank Terms</span>
                  <h3>前排更常见的标题词</h3>
                </div>
              </div>
              <p class="panel-note">这一组词是拿前排样本和整批样本做对比后，更集中出现在靠前商品里的词。</p>
              {_render_chips(
                  analysis.get("front_rank_terms", []),
                  count_key="front_count",
                  coverage_key="front_coverage",
                  extra_key="overall_coverage",
              )}
            </section>

            <section class="tab-panel panel-traits">
              <div class="section-head">
                <div>
                  <span class="section-kicker">Shared Traits</span>
                  <h3>前排更常见的共性</h3>
                </div>
              </div>
              <p class="panel-note">这些共性只表示在当前样本里前排商品更常见，不代表平台因果规则。</p>
              {_render_trait_cards(analysis.get("shared_traits", []), front_sample_size)}
            </section>

            <section class="tab-panel panel-distributions">
              <div class="section-head">
                <div>
                  <span class="section-kicker">Distribution</span>
                  <h3>分布概览</h3>
                </div>
              </div>
              <p class="panel-note">把当前样本的店铺类型、价格带、销量带、发货地和活动标签做了可视化整理。</p>
              {_render_distribution_groups(distributions)}
            </section>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Details</span>
            <h2>完整商品明细</h2>
          </div>
          <div class="tag-row">
            <span class="tag">与 JSON / CSV 同源</span>
            <span class="tag">共 {escape(_format_plain_number(result.collected_count))} 条</span>
          </div>
        </div>
        <div class="detail-scroll">
          {_render_products_table(result.products)}
        </div>
        <p class="footnote">报告内所有统计均由本次抓到的 {escape(str(result.collected_count))} 条商品实时计算；标题词和共性分析仅用于观察当前搜索页样本特征。</p>
      </section>
    </div>
  </div>
</body>
</html>"""


def _render_stat_card(label: str, value: str) -> str:
    return (
        '<div class="card">'
        f'<div class="muted">{escape(label)}</div>'
        f"<strong>{escape(value)}</strong>"
        "</div>"
    )


def _render_insights(insights: Iterable[str]) -> str:
    rows = list(insights)
    if not rows:
        return '<p class="muted">当前没有可展示的分析结论。</p>'
    items = "".join(f"<li>{escape(item)}</li>" for item in rows)
    return f'<ol class="insight-list">{items}</ol>'


def _render_chips(
    rows: Iterable[dict[str, Any]],
    *,
    count_key: str,
    coverage_key: str,
    extra_key: str | None = None,
) -> str:
    data = list(rows)
    if not data:
        return '<p class="muted">当前样本里没有识别到足够稳定的词频结果。</p>'

    chips = []
    for item in data:
        content = [
            f"<strong>{escape(str(item.get('term', '')))}</strong>",
            f"<span>覆盖商品数：{escape(str(item.get(count_key, 0)))}</span>",
            f"<span>覆盖率：{escape(_format_percent(item.get(coverage_key, 0)))}</span>",
        ]
        if extra_key:
            content.append(
                f"<span>全样本覆盖率：{escape(_format_percent(item.get(extra_key, 0)))}</span>"
            )
        chips.append(f'<div class="chip">{"".join(content)}</div>')
    return f'<div class="chips">{"".join(chips)}</div>'


def _render_trait_cards(rows: Iterable[dict[str, Any]], front_sample_size: int) -> str:
    data = list(rows)
    if not data:
        return '<p class="muted">当前前排样本里没有明显高于全样本的特征。</p>'

    cards = []
    for item in data:
        cards.append(
            '<div class="trait-card">'
            f'<span class="trait-type">{escape(_trait_type_label(item.get("trait_type", "")))}</span>'
            f'<strong>{escape(str(item.get("label", "")))}</strong>'
            '<div class="trait-metrics">'
            '<div class="metric-box">'
            '<span>前排覆盖</span>'
            f'<b>{escape(str(item.get("front_count", 0)))}/{escape(str(front_sample_size))}</b>'
            '</div>'
            '<div class="metric-box">'
            '<span>前排覆盖率</span>'
            f'<b class="accent">{escape(_format_percent(item.get("front_coverage", 0)))}</b>'
            '</div>'
            '<div class="metric-box">'
            '<span>全样本覆盖率</span>'
            f'<b>{escape(_format_percent(item.get("overall_coverage", 0)))}</b>'
            '</div>'
            '<div class="metric-box">'
            '<span>覆盖率差值</span>'
            f'<b>{escape(_format_percent(item.get("coverage_delta", 0)))}</b>'
            '</div>'
            '</div>'
            '</div>'
        )
    return f'<div class="trait-grid">{"".join(cards)}</div>'


def _render_distribution_groups(distributions: dict[str, Any]) -> str:
    groups = [
        ("店铺类型", distributions.get("shop_types", []), 8),
        ("价格带", distributions.get("price_buckets", []), 8),
        ("优惠金额", distributions.get("coupon_buckets", []), 8),
        ("销量带", distributions.get("sales_buckets", []), 8),
        ("发货地", distributions.get("locations", []), 10),
        ("活动标签", distributions.get("activity_tags", []), 10),
    ]

    cards = [
        _render_distribution_card(title, rows, limit=limit)
        for title, rows, limit in groups
    ]
    return f'<div class="distribution-grid">{"".join(cards)}</div>'


def _render_distribution_card(
    title: str,
    rows: Iterable[dict[str, Any]],
    *,
    limit: int,
) -> str:
    data = list(rows)[:limit]
    if not data:
        content = '<p class="muted">当前样本暂无数据。</p>'
    else:
        items = []
        for item in data:
            coverage = float(item.get("coverage", 0) or 0)
            items.append(
                '<div class="distribution-item">'
                '<div class="distribution-topline">'
                f'<span>{escape(str(item.get("label", "")))}</span>'
                f'<span>{escape(str(item.get("count", 0)))} / {escape(_format_percent(coverage))}</span>'
                '</div>'
                '<div class="distribution-bar">'
                f'<i style="width:{max(0.0, min(coverage * 100, 100.0)):.2f}%"></i>'
                '</div>'
                '</div>'
            )
        content = f'<div class="distribution-list">{"".join(items)}</div>'

    return (
        '<div class="distribution-card">'
        f"<strong>{escape(title)}</strong>"
        f"{content}"
        "</div>"
    )


def _render_products_table(products: list[dict[str, Any]]) -> str:
    if not products:
        return '<p class="muted" style="padding:16px;">当前没有抓到商品数据。</p>'

    columns = list(products[0].keys())
    head = "".join(
        f"<th>{escape(_product_field_label(column))}</th>" for column in columns
    )
    rows = []
    for product in products:
        cells = "".join(
            f"<td>{_render_cell_html(column, product.get(column))}</td>"
            for column in columns
        )
        rows.append(f"<tr>{cells}</tr>")
    return f'<table class="detail-table"><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>'


def _trait_type_label(value: Any) -> str:
    key = str(value or "")
    return TRAIT_TYPE_LABEL_MAP.get(key, key or "-")


def _product_field_label(value: Any) -> str:
    key = str(value or "")
    return PRODUCT_FIELD_LABEL_MAP.get(key, key or "-")


def _format_cell_value(value: Any) -> str:
    if isinstance(value, bool):
        return "是" if value else "否"
    if value is None:
        return "-"
    text = str(value)
    return text if text else "-"


def _render_cell_html(column: str, value: Any) -> str:
    text = _format_cell_value(value)
    preview_html = _render_cell_content(column, text)
    hover_html = _render_cell_content(column, text)
    return (
        '<div class="detail-cell">'
        f'<div class="detail-cell-preview">{preview_html}</div>'
        f'<div class="detail-cell-hover">{hover_html}</div>'
        "</div>"
    )


def _render_cell_content(column: str, text: str) -> str:
    if column in {"main_image", "shop_link", "product_link"} and text not in {"", "-"}:
        return (
            f'<a class="detail-content-link" href="{escape(text)}" target="_blank" rel="noreferrer">'
            f"{escape(text)}"
            "</a>"
        )
    return escape(text)


def _format_percent(value: Any) -> str:
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return "0.00%"


def _format_plain_number(value: Any) -> str:
    try:
        return f"{int(float(value)):,}"
    except (TypeError, ValueError):
        return "0"


def _format_number(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "0"
    if number.is_integer():
        return f"{int(number):,}"
    return f"{number:,.2f}"
