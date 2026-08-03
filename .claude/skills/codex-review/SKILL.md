---
name: codex-review
description: 書いたコードを別モデル（Codex）にレビューさせる。push や PR 作成の前に実行する。「レビューして」「codex に見せて」「push する前に確認」などで発動する。
allowed-tools: Bash(codex exec review *), Bash(git status *), Bash(git log *), Bash(git diff *), Read
---

# codex-review — 別モデルによるレビュー

Claude が書いたコードを **Codex** にレビューさせる。ChatGPT のサブスク枠で動く（API課金は発生しない）。

## なぜ別モデルなのか

`src/` に人間のレビューは入らず、CIのテストが唯一の壁。そしてそのテストを書くのも Claude。
**同じモデルは自分の判断を追認する**ので、実装に合わせた甘いテストを自分では見つけられない。
ここだけが別モデルにしか見えない領域で、この skill の存在理由もそこにある。

判定基準は `AGENTS.md`。Codex は project instructions として自動で読むので、プロンプトで
渡し直さない。

## 実行

PR 単位（main との差分）:

```bash
codex exec review --base main -o .codex-review.md
```

コミット前の作業ツリー:

```bash
codex exec review --uncommitted -o .codex-review.md
```

`.codex-review.md` を Read で読む。**標準出力は進捗ログなので追わない。**
`.codex-review.md` は `.gitignore` 済み。コミットしない。

レビューには1〜数分かかる。`run_in_background: true` で走らせ、完了通知を待つ間に
他の作業を進めてよい。

## 指摘の分類

**Codex の指摘をそのまま実装しない。** 3つに分ける。

| 分類 | 対応 |
|---|---|
| 本物の修正 | 直す |
| 妥当な nitpick | 安ければ直す。高くつくなら理由を書いて残す |
| 誤検知・古い前提 | **直さない。** 理由を1行書いて飛ばす |

誤検知に入るもの：

- `AGENTS.md` の「指摘しないこと」に該当する指摘（フォーマット、命名の好み、CIが既に見ている範囲、抽象化の不足）
- このリポジトリの設計意図を知らずに出す一般論。保護パス、fail closed のCI、最小構成の方針は Codex からは見えない
- 既に別の層で担保されているもの（秘密情報のパターンマッチは gitleaks が見ている）

## 終わり方

ユーザーに次を報告する。

- 本物の修正として直したもの
- 飛ばしたものと、その理由
- **レビューが空だった場合はそう言う。**「問題なし」を捏造しない

**レビューを通したことを、コードが正しい証明として報告しない。** Codex が見るのは差分であって、
仕様との一致ではない。仕様の確認は別の仕事。
