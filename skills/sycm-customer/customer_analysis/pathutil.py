from __future__ import annotations

import re

_UNSAFE_PATH_CHARS = re.compile(r"[\\/:*?\"<>|]+")
_WHITESPACE = re.compile(r"\s+")


def sanitize_path_component(value: str, *, collapse_whitespace: bool = False, fallback: str = "unknown") -> str:
    text = _UNSAFE_PATH_CHARS.sub("_", value.strip())
    if collapse_whitespace:
        text = _WHITESPACE.sub("_", text)
    return text or fallback
