"""検証用の使い捨てファイル。

Codex の GitHub 連携で「自動レビュー（PRのオープン時）」トリガーが
どのような形式で結果を投稿するか（構造化された review か、プレーンな
issue コメントか）を確認するためだけに存在する。確認が終わったら
次のPRで削除する。src/ には置かない（run-tests.sh の壁ロジックに
影響させないため）。
"""


def add(a: int, b: int) -> int:
    return a + b
