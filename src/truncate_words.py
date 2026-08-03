import re

_WHITESPACE_RE = re.compile(r"\s+")


def truncate_words(text: str, max_words: int, ellipsis: str = "…") -> str:
    """text を max_words 語に切り詰める。超える場合は末尾に ellipsis を付ける。

    語数が max_words 以下ならそのまま（空白は正規化）返し、ellipsis は付けない。
    max_words == 0 の場合、text が空でなければ ellipsis のみを返す。
    text が空文字列・空白のみの場合は max_words によらず "" を返す。
    max_words が負の場合は ValueError を送出する（text の中身より検証が先）。
    """
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
