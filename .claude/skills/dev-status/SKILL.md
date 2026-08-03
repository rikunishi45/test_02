---
name: dev-status
description: この開発環境自体の状態（PRのマージ状況、CIの健康度、codex-reviewの利用実績、技術スタックの変遷）をダッシュボードとして表示する。「開発状況を見せて」「ダッシュボード」「dev-status」などで発動する。
allowed-tools: Bash(gh pr list *), Bash(gh pr view *), Bash(gh run list *), Bash(gh run view *), Bash(git log *), Bash(git rev-parse *), Bash(jq *), Read
---

# dev-status — 開発環境の状態ダッシュボード

このリポジトリ自体（PR履歴・CI・codex-reviewの利用・技術スタックの変遷）を可視化する。
**進捗の正本はPR履歴のまま。** このskillは新しい記録場所を作らず、既存のGitHub/gitのデータを
集計して表示するだけの「ビュー」。唯一の例外は `codex-review-log.jsonl`（後述）。

## 実行

1. データを集計する。

```bash
${CLAUDE_SKILL_DIR}/gather.sh
```

JSON 1個が標準出力に返る。`prs`（PR一覧・保護パス判定済み）、`ci_jobs`（ジョブ単位の
成否）、`codex_review_log`（後述の観測ログの中身）、`tech_stack_verification_cycles`
（`run-tests.sh` が追加された回数）、`tech_stack_currently_active`（現在生きているか）
を含む。

2. **`artifact-design` skill を読んでから**、このJSONを元にHTMLダッシュボードを組み立て、
   Artifact tool で表示する。

## 各指標の出し方（gather.sh の中身の要約）

| 指標 | 由来 | 精度 |
|---|---|---|
| PRのマージ状況・保護パス比率 | `gh pr list` + `gh pr view --json files` を保護パス正規表現と照合 | 高（決定的な判定） |
| CIの健康度 | `gh run list` / `gh run view --json jobs` のジョブ単位 conclusion | 高（GitHub自身の記録） |
| codex-review利用実績 | `codex-review-log.jsonl`（後述） | 実行回数は正確。ただし記録開始前の実行分は含まれない |
| 技術スタックの変遷 | `git log --diff-filter=A -- run-tests.sh` の件数 | 高（このリポジトリでは検証サイクルのたびに毎回この経路を通っている） |

CIのジョブ数（テスト／秘密情報スキャン）が一致しないことがある。**バグではない。**
`テスト` ジョブは PR #6 で新設されたため、それ以前の実行分には存在しない。

## `codex-review-log.jsonl` について

リポジトリルートに置く、追記専用の観測ログ（JSONL、1行1レビュー実行）。`codex-triage`
agent が `codex exec review` を実行するたびに1行追記する。

**このログは観測用途のみ。検証・強制の道具として使わない。** 書いているのが Claude
自身（`codex-triage`）である以上、「レビューが実際に行われた証明」にはなり得ない
——それは CI層にCodexを置かなかった理由と同じ制約。ダッシュボード上でも「参考情報」
として表示する。

保護パスには含めない（設定やルールではなく、単なる追記ログのため）。

## 表示する指標

- PRのマージ状況：保護パス比率、未マージPR一覧
- CIの健康度：テスト/秘密情報スキャンそれぞれの成功率
- codex-reviewの利用実績：記録済みの実行回数、指摘ありだった割合
- 技術スタックの変遷：検証サイクルの回数、現在アクティブか
