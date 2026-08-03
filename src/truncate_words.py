import re

_WHITESPACE_RE = re.compile(r"\s+")


def truncate_words(text: str, max_words: int, ellipsis: str = "…") -> str:
    if max_words < 0:
        raise ValueError("max_words must not be negative")

    words = _WHITESPACE_RE.split(text.strip())
    words = [w for w in words if w]

    if not words:
        return ""

    if max_words == 0:
        return ellipsis

    if len(words) <= max_words:
        return " ".join(words)

    return " ".join(words[:max_words]) + " " + ellipsis
