"""问大家问题标题分词 — product-wdj 独立模块，不依赖 product-reviews。"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

# 通用虚词
_STOP_WORDS = frozenset(
    """
    的 了 是 在 我 有 和 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好
    自己 这 那 他 她 它 我们 你们 他们 这个 那个 这样 那样 一下 一点 一些 每个 多少
    因为 所以 但是 如果 而且 或者 非常 比较 真的 感觉 觉得 还有 就是 已经 还是
    卖家 商家 宝贝 商品 买家 用户 提问 回答 问大家
    """.split()
)

# 问大家常见问句套话（保留「连接/质量/通话」等实质词）
_QUESTION_TEMPLATE_WORDS = frozenset(
    """
    怎么 怎么样 如何 为什么 什么 哪个 哪些 哪里 多少 能不能 可不可以 是否可以 是不是
    有没有 行不行 好不好 可以吗 请问 吗 呢 啊 呀 吧 嘛
    """.split()
)


def _jieba_cut(text: str) -> list[str]:
    import jieba

    return list(jieba.cut(text))


def collect_question_texts(questions: list[dict[str, Any]]) -> list[str]:
    texts: list[str] = []
    for question in questions:
        title = str(question.get("question_title") or "").strip()
        if title:
            texts.append(title)
    return texts


def build_question_word_freq(
    questions: list[dict[str, Any]],
    *,
    top_n: int = 12,
) -> Counter[str]:
    counter: Counter[str] = Counter()
    for text in collect_question_texts(questions):
        for token in _jieba_cut(text):
            word = token.strip()
            if len(word) < 2:
                continue
            if word in _STOP_WORDS or word in _QUESTION_TEMPLATE_WORDS:
                continue
            if re.fullmatch(r"[\W\d_]+", word):
                continue
            counter[word] += 1
    if top_n > 0:
        return Counter(dict(counter.most_common(top_n)))
    return counter


def top_question_keywords(
    questions: list[dict[str, Any]],
    *,
    top_n: int = 12,
) -> list[tuple[str, int]]:
    try:
        return build_question_word_freq(questions, top_n=top_n).most_common()
    except ImportError:
        return []
