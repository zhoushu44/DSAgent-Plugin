from __future__ import annotations

import json
import re
from collections import Counter
from html import escape
from typing import Any

_STOP_WORDS = frozenset(
    """
    的 了 是 在 我 有 和 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好
    自己 这 那 他 她 它 我们 你们 他们 这个 那个 什么 怎么 可以 已经 还是 因为 所以
    但是 如果 而且 或者 非常 比较 真的 感觉 觉得 还是 还有 就是 这样 那样 一下 一点
    一些 每个 多少 怎么 为什么 时候 东西 卖家 商家 宝贝 商品 收到 购买 买 用 使用 谢谢
    该用户未填写评价内容
    """.split()
)

_SKIP_FEEDBACK = frozenset({"该用户未填写评价内容", "-", ""})

_COLOR_PALETTE = (
    "#2563eb",
    "#1d4ed8",
    "#60a5fa",
    "#3b82f6",
    "#64748b",
    "#475569",
    "#93c5fd",
    "#1e40af",
    "#bfdbfe",
    "#94a3b8",
)


def _jieba_cut(text: str) -> list[str]:
    import jieba

    return list(jieba.cut(text))


def collect_review_texts(reviews: list[dict[str, Any]]) -> list[str]:
    texts: list[str] = []
    for review in reviews:
        for key in ("feedback", "append_feedback"):
            text = str(review.get(key) or "").strip()
            if text in _SKIP_FEEDBACK:
                continue
            texts.append(text)
    return texts


def build_word_freq(reviews: list[dict[str, Any]], *, top_n: int = 40) -> Counter[str]:
    counter: Counter[str] = Counter()
    for text in collect_review_texts(reviews):
        for token in _jieba_cut(text):
            word = token.strip()
            if len(word) < 2:
                continue
            if word in _STOP_WORDS:
                continue
            if re.fullmatch(r"[\W\d_]+", word):
                continue
            counter[word] += 1
    if top_n > 0:
        return Counter(dict(counter.most_common(top_n)))
    return counter


def build_keyword_index_map(
    reviews: list[dict[str, Any]],
    *,
    top_n: int = 40,
) -> list[dict[str, Any]]:
    try:
        word_freq = build_word_freq(reviews, top_n=top_n)
    except ImportError:
        return []

    items: list[dict[str, Any]] = []
    for word, count in word_freq.most_common():
        indices: list[int] = []
        for index, review in enumerate(reviews):
            text = f"{review.get('feedback') or ''}{review.get('append_feedback') or ''}"
            if word in text:
                indices.append(index)
        items.append({"word": word, "count": count, "indices": indices})
    return items


def render_keyword_table_panel(reviews: list[dict[str, Any]]) -> str:
    try:
        keyword_items = build_keyword_index_map(reviews)
    except ImportError:
        return (
            '<div class="insight-left">'
            '<h2 class="insight-title">关键词梳理</h2>'
            '<p class="empty muted">缺少 jieba 分词库，请安装后重新生成报告。</p>'
            "</div>"
        )

    if not keyword_items:
        return (
            '<div class="insight-left">'
            '<h2 class="insight-title">关键词梳理</h2>'
            '<p class="empty muted">暂无有效评价文本，无法提取关键词。</p>'
            "</div>"
        )

    rows: list[str] = []
    for index, item in enumerate(keyword_items):
        word = str(item["word"])
        count = int(item["count"])
        indices_json = escape(json.dumps(item["indices"]))
        rows.append(
            "<tr "
            f'data-keyword="{escape(word)}" data-indices="{indices_json}">'
            f'<td class="kw-check"><input type="checkbox" class="kw-filter" '
            f'id="kw-{index}" data-keyword="{escape(word)}" '
            f'aria-label="筛选 {escape(word)}"></td>'
            f'<td class="kw-word"><label for="kw-{index}">{escape(word)}</label></td>'
            f'<td class="kw-count" data-kw-count="{count}">{count}</td>'
            "</tr>"
        )

    return (
        '<div class="insight-left">'
        '<h2 class="insight-title">关键词梳理</h2>'
        '<p class="insight-hint muted">勾选关键词可筛选下方评价明细</p>'
        '<div class="kw-table-wrap">'
        '<table class="kw-table">'
        "<thead><tr>"
        '<th class="kw-check"></th>'
        "<th>关键词</th>"
        "<th>出现次数</th>"
        "</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
        "</div>"
        "</div>"
    )


def _estimate_box(word: str, font_size: float) -> tuple[float, float]:
    width = font_size * len(word) * 0.92
    height = font_size * 1.15
    return width, height


def _boxes_overlap(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
    *,
    padding: float = 4,
) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (
        ax + aw + padding < bx
        or bx + bw + padding < ax
        or ay + ah + padding < by
        or by + bh + padding < ay
    )


def render_word_cloud_svg(
    word_freq: Counter[str],
    *,
    width: int = 440,
    height: int = 220,
    max_words: int = 30,
) -> str:
    import math

    items = word_freq.most_common(max_words)
    if not items:
        return ""

    max_count = items[0][1]
    min_count = items[-1][1]

    def font_size(count: int) -> float:
        if max_count == min_count:
            return 26.0
        ratio = (count - min_count) / (max_count - min_count)
        return 14.0 + ratio * 18.0

    center_x = width / 2
    center_y = height / 2
    placed: list[tuple[float, float, float, float]] = []
    elements: list[str] = []

    for index, (word, count) in enumerate(items):
        size = font_size(count)
        box_w, box_h = _estimate_box(word, size)
        placed_word = False

        for step in range(900):
            angle = step * 0.32
            radius = 1.5 + step * 0.75
            x = center_x + radius * math.cos(angle) - box_w / 2
            y = center_y + radius * math.sin(angle) - box_h / 2

            if x < 6 or y < 6 or x + box_w > width - 6 or y + box_h > height - 6:
                continue

            candidate = (x, y, box_w, box_h)
            if any(_boxes_overlap(candidate, existing) for existing in placed):
                continue

            placed.append(candidate)
            color = _COLOR_PALETTE[index % len(_COLOR_PALETTE)]
            text_x = x + box_w / 2
            text_y = y + box_h * 0.82
            elements.append(
                f'<text class="wc-word" data-word="{escape(word)}" x="{text_x:.1f}" y="{text_y:.1f}" '
                f'font-size="{size:.1f}" fill="{color}" text-anchor="middle">'
                f"{escape(word)}"
                f'<title>{escape(word)} · {count} 次</title></text>'
            )
            placed_word = True
            break

        if not placed_word and index == 0:
            x = center_x - box_w / 2
            y = center_y - box_h / 2
            placed.append((x, y, box_w, box_h))
            elements.append(
                f'<text class="wc-word" data-word="{escape(word)}" x="{center_x:.1f}" y="{center_y + box_h * 0.32:.1f}" '
                f'font-size="{size:.1f}" fill="{_COLOR_PALETTE[0]}" text-anchor="middle">'
                f"{escape(word)}"
                f'<title>{escape(word)} · {count} 次</title></text>'
            )

    if not elements:
        return ""

    return (
        f'<svg class="word-cloud" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="评价词云">'
        f'{"".join(elements)}</svg>'
    )


def render_word_cloud_panel(reviews: list[dict[str, Any]]) -> str:
    try:
        word_freq = build_word_freq(reviews)
    except ImportError:
        return (
            '<div class="insight-right">'
            '<h2 class="insight-title">评价词云</h2>'
            '<p class="empty muted">缺少 jieba 分词库，请安装后重新生成报告。</p>'
            "</div>"
        )

    cloud_svg = render_word_cloud_svg(word_freq)
    if not cloud_svg:
        return (
            '<div class="insight-right">'
            '<h2 class="insight-title">评价词云</h2>'
            '<p class="empty muted">暂无有效评价文本，无法生成词云。</p>'
            "</div>"
        )

    return (
        '<div class="insight-right">'
        '<h2 class="insight-title">评价词云</h2>'
        f'<div class="word-cloud-wrap">{cloud_svg}</div>'
        "</div>"
    )
