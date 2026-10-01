from __future__ import annotations

import csv
from pathlib import Path

from .types import QuestionRecord

HEADERS = [
    "序号",
    "问题ID",
    "问题",
    "提问用户",
    "提问标签",
    "提问时间",
    "提问地区",
    "回答数",
    "回答ID",
    "回答内容",
    "回答用户",
    "回答时间",
    "SKU",
    "购买标签",
    "点赞数",
    "信誉等级",
]


def export_csv(questions: list[QuestionRecord], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        for question in questions:
            if not question.answers:
                writer.writerow([
                    question.index,
                    question.question_id,
                    question.question_title,
                    question.user,
                    question.user_tags,
                    question.ask_time,
                    question.ip_location,
                    question.answer_count,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                ])
                continue
            for answer in question.answers:
                writer.writerow([
                    question.index,
                    question.question_id,
                    question.question_title,
                    question.user,
                    question.user_tags,
                    question.ask_time,
                    question.ip_location,
                    question.answer_count,
                    answer.answer_id,
                    answer.content,
                    answer.user,
                    answer.answer_time_str or answer.answer_time,
                    answer.sku,
                    answer.rate_tag or answer.user_tags,
                    answer.like_count,
                    answer.credit_level,
                ])
    return str(output_path)
