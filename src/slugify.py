# 3.9 以前でも `int | None` 注釈を評価できるようにする。CIは3.12だが、
# 手元の python3 が古い環境でもテストを走らせるため。
from __future__ import annotations

import re

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def slugify(text: str, max_length: int | None = None) -> str:
    """英数字以外を単一のハイフンに畳んだ小文字のslugを返す。

    max_length を指定した場合、その長さ以内に収まる最後の語境界で切る。
    最初の語だけで max_length を超える場合は、その語を途中で切る。
    """
    slug = _NON_ALNUM.sub("-", text.lower()).strip("-")
    if max_length is None or len(slug) <= max_length:
        return slug

    cut = slug[:max_length]
    # 切った位置がちょうど語境界なら、直前の語を落とさない。
    if slug[max_length] != "-" and "-" in cut:
        cut = cut.rsplit("-", 1)[0]
    return cut.strip("-")
