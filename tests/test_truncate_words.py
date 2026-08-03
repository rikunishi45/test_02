import pytest

from src.truncate_words import truncate_words


# --- 語数が max_words 以下（正常系・空白正規化・境界値） ---

def test_returns_joined_words_when_count_within_limit():
    assert truncate_words("hello world", 5) == "hello world"


def test_boundary_word_count_equals_max_words_no_ellipsis():
    # 語数がちょうど max_words に等しい場合は ellipsis を付けない
    assert truncate_words("a b c", 3) == "a b c"


def test_single_word_exactly_at_limit_no_ellipsis():
    assert truncate_words("hello", 1) == "hello"


def test_normalizes_internal_whitespace_when_within_limit():
    assert truncate_words("hello   world\t\nfoo", 10) == "hello world foo"


def test_strips_leading_and_trailing_whitespace_within_limit():
    assert truncate_words("  hello world  ", 5) == "hello world"


# --- 語数が max_words を超える場合（truncate + ellipsis） ---

def test_truncates_and_appends_ellipsis_when_count_exceeds_max_words():
    assert truncate_words("a b c d e", 3) == "a b c …"


def test_single_word_truncated_to_one_word():
    assert truncate_words("hello world", 1) == "hello …"


def test_normalizes_internal_whitespace_when_truncating():
    assert truncate_words("hello   world\t\nfoo   bar", 2) == "hello world …"


def test_strips_leading_and_trailing_whitespace_when_truncating():
    assert truncate_words("  hello world foo bar  ", 2) == "hello world …"


def test_default_ellipsis_is_horizontal_ellipsis_character():
    result = truncate_words("one two three", 1)
    assert result == "one …"


# --- max_words == 0 ---

def test_max_words_zero_non_empty_text_returns_only_ellipsis():
    # 語は1つも含めず、先頭スペースも付かない
    assert truncate_words("a b c", 0) == "…"


def test_max_words_zero_single_word_returns_only_ellipsis():
    assert truncate_words("hello", 0) == "…"


def test_max_words_zero_custom_ellipsis():
    assert truncate_words("a b c", 0, ellipsis="[cut]") == "[cut]"


# --- 空文字列・空白のみの文字列（max_words の値によらず "" ） ---

def test_empty_string_returns_empty_with_positive_max_words():
    assert truncate_words("", 5) == ""


def test_empty_string_returns_empty_with_max_words_zero():
    assert truncate_words("", 0) == ""


def test_whitespace_only_string_returns_empty_with_positive_max_words():
    assert truncate_words("   ", 3) == ""


def test_whitespace_only_string_with_tabs_and_newlines_returns_empty():
    assert truncate_words("\t\n \t", 3) == ""


def test_whitespace_only_string_returns_empty_with_max_words_zero():
    assert truncate_words("   \t\n", 0) == ""


# --- max_words が負の場合 ---

def test_negative_max_words_raises_value_error():
    with pytest.raises(ValueError):
        truncate_words("hello world", -1)


def test_negative_max_words_raises_value_error_for_larger_magnitude():
    with pytest.raises(ValueError):
        truncate_words("hello world", -5)


def test_negative_max_words_raises_value_error_even_with_empty_text():
    # 入力検証（負の max_words）は text の中身より先に行われる
    with pytest.raises(ValueError):
        truncate_words("", -1)


def test_negative_max_words_raises_value_error_even_with_whitespace_only_text():
    with pytest.raises(ValueError):
        truncate_words("   \t\n", -1)


# --- ellipsis の差し替え ---

def test_custom_ellipsis_used_when_truncating():
    assert truncate_words("a b c d", 2, ellipsis="...(more)") == "a b ...(more)"


def test_empty_ellipsis_string_still_adds_trailing_space_when_truncating():
    # ellipsis が空文字列でも「末尾に半角スペース1個とellipsis」の規則は変わらない
    assert truncate_words("a b c d", 2, ellipsis="") == "a b "
