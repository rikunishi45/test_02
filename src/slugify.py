# 3.9 以前でも `int | None` 注釈を評価できるようにする。CIは3.12だが、
# 手元の python3 が古い環境でもテストを走らせるため。
from __future__ import annotations

import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _strip_accents(text: str) -> str:
    """アクセントを落として基底文字だけ残す。"café" -> "cafe"

    NFKD で「基底文字＋結合文字」に分解し、結合文字を捨てる。
    分解できない文字（ドイツ語の ß、非ラテン文字）はそのまま残るので、
    後続の _NON_ALNUM で落ちる。
    """
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def slugify(text: str, max_length: int | None = None) -> str:
    """英数字以外を単一のハイフンに畳んだ小文字のslugを返す。

    アクセント付きラテン文字は基底文字に落とす（"Café" -> "cafe"）。
    非ラテン文字（日本語など）は表現できないため落ちる。

    max_length を指定した場合、その長さ以内に収まる最後の語境界で切る。
    最初の語だけで max_length を超える場合は、その語を途中で切る。
    """
    slug = _NON_ALNUM.sub("-", _strip_accents(text.lower())).strip("-")
    if max_length is None or len(slug) <= max_length:
        return slug

    cut = slug[:max_length]
    # 切った位置がちょうど語境界なら、直前の語を落とさない。
    if slug[max_length] != "-" and "-" in cut:
        cut = cut.rsplit("-", 1)[0]
    return cut.strip("-")
