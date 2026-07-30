from src.slugify import slugify


def test_単語をハイフンでつなぐ():
    assert slugify("Hello World") == "hello-world"


def test_連続する記号を1つのハイフンに畳む():
    assert slugify("a -- b") == "a-b"


def test_前後のハイフンを削る():
    assert slugify("!!Hello!!") == "hello"


def test_英数字が無ければ空文字を返す():
    assert slugify("!!!") == ""


def test_アクセントを基底文字に落とす():
    assert slugify("Café") == "cafe"


def test_ウムラウトを基底文字に落とす():
    assert slugify("Münster Straße") == "munster-stra-e"


def test_非ラテン文字は表現できないので落ちる():
    assert slugify("日本語") == ""


def test_アクセントを落とした後にmax_lengthを適用する():
    assert slugify("Café Münster", max_length=4) == "cafe"


def test_max_length未指定なら切らない():
    assert slugify("hello world foo") == "hello-world-foo"


def test_max_lengthを超える語を落とす():
    assert slugify("hello world foo", max_length=13) == "hello-world"


def test_切った位置が語境界なら直前の語を残す():
    assert slugify("hello world foo", max_length=11) == "hello-world"


def test_最初の語だけで超える場合は語中で切る():
    assert slugify("hello world", max_length=3) == "hel"
