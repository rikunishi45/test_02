# test_02 — CLAUDE.md

@AGENTS.md

## プロジェクト概要

**目的：** 個人開発でAIを自走させるための最小構成の開発環境。安全性は人間の都度承認ではなく、GitHub側の機械的な壁で担保する。
**Status:** active
**作成日：** 2026-07-30

---

## 技術スタック

実コードは未着手。決めた時点でここに記入する。

| レイヤー | 技術 |
|---|---|
| 言語 | 未定 |
| テストランナー | 未定 |
| CI | GitHub Actions |

---

## テストの壁（`run-tests.sh`）

`src/` は保護パスではない。人間のレビューが入らないため、**CIのテストが唯一の壁**になる。

CIの `テスト` ジョブは fail closed で動く：

| 状況 | 結果 |
|---|---|
| `run-tests.sh` がある | 実行する。落ちればマージされない |
| `run-tests.sh` が無く `src/` も無い | 通る（現在の状態） |
| `run-tests.sh` が無いのに `src/` がある | **失敗する** |

つまり **`src/` に最初にコードを書くPRには `run-tests.sh` を同梱する**。実行権限（`chmod +x`）を忘れるとCIが落ちる。

```bash
#!/usr/bin/env bash
set -euo pipefail
pip install -q pytest==8.3.4 pytest-cov==6.0.0   # 版を固定する。外部要因で赤くならないため
pytest tests/ --cov=src --cov-fail-under=80
```

`run-tests.sh` は保護パス。**ここで決めた下限（カバレッジ閾値など）はAIが下げられない。**
テスト本体（`tests/`）は保護しないので自由に追加・修正してよい。

**この壁が防ぐのは「テストが1本も走らずにマージされる」ことだけ。** 実装に合わせた
甘いテストを書いて通すことは防げない（`tests/` を保護しない以上、構造的に残る）。

---

## モデルとサブエージェント

メインセッション（Supervisor）は Opus 5、サブエージェントは Sonnet 5。割り当ては
`.claude/settings.json` の `model` と `CLAUDE_CODE_SUBAGENT_MODEL` で固定してある。

- 大量のファイル読み込みや試行錯誤が発生する作業は、サブエージェントに委任する。探索ログでメインの文脈を汚さないため。
- 1〜3ステップで終わる作業は直接実行する。委任のオーバーヘッドの方が大きい。
- 委任時に `model` は指定しない。設定側で固定済み。

### プロジェクト固有のサブエージェント

`.claude/agents/` に2体定義してある。個別のモデル指定はしない（`model: inherit` のまま。
`CLAUDE_CODE_SUBAGENT_MODEL` を継承する）。

| agent | 役割 |
|---|---|
| `test-writer` | 仕様からテストを書く。実装ファイルへのパスは渡さない |
| `codex-triage` | `codex exec review` を実行し、`AGENTS.md` の基準で分類した要約だけを返す |

いずれも「大量の読み込みでメインの文脈を汚さない」ための委任先で、UI/マーケ/法務のような
専門職エージェントは今は作らない（要ると分かった時点で同じ場所に追加する）。

---

## 開発フロー

1. `main` から作業ブランチを切る（`feature/<短い説明>`）。
2. 実装する。**`src/` を変更するPRには対応するテストを必ず含める。** `src/` に人間のレビューは入らず、CIが唯一の壁になるため。
3. **push の前に `/codex-review` を実行する。** 別モデル（Codex）に差分を読ませる。同じモデルは自分の判断を追認するので、実装に合わせた甘いテストを自分では見つけられない。指摘は分類してから対応する（`.claude/skills/codex-review/SKILL.md`）。
4. `git push` して `gh pr create` する。
5. `automerge.yml` が自動マージを予約し、あとはGitHubが判定する。
   - 保護パス外 かつ CI green → 自動マージ
   - 保護パスを含む → 人間がマージするまで待機
6. **AIはPRをマージしない。** `gh pr merge` は `deny`。

**中間コミットでPRを作らない。** ブランチ上では自由にコミットし、タスクが完結した時点でPRを1本作る。逆に、タスクが別ならサイズが小さくてもPRを分ける — 自動マージされるPRのレビューコストはゼロで、混在させると保護パス1つで全体が止まる。

---

## 保護パス（人間のマージ承認が必要）

| パス | 理由 |
|---|---|
| `/.github/` | CIと自動マージの仕組みそのもの |
| `/.claude/` | エージェントの権限設定そのもの |
| `/CLAUDE.md` | このファイル |
| `/AGENTS.md` | レビューの判定基準。AIが自分の採点基準を緩められると、別モデルのレビューが壁として機能しなくなる |
| `/setup-github.sh` | 人間が手で実行するブートストラップ |
| `/run-tests.sh` | `src/` に対する壁の定義 |

ここを自動マージ可にすると、**AIが自分の制約を緩める変更を無人でマージできる。** 一度それが起きると他のすべての対策が同時に無効になる。単一障害点なので例外を作らない。

**壁の実体は `.github/workflows/automerge.yml` の判定。** 保護パスを含むPRには自動マージを予約しない。AIは `gh pr merge` を持たないので、予約されなければマージ経路が存在しない。

`.github/CODEOWNERS` は壁ではない。PRの作成者が唯一のコードオーナーの場合、GitHubは本人にレビューを要求しないため、`require_code_owner_review` は実質的に無効化される（PR #2 で実測）。レビュー要求の宛先としてのみ残してある。

定義は4か所に写っている。**1か所だけ変えると穴が開く。** ①この表、②`automerge.yml` の grep パターン、③`.github/CODEOWNERS`、④`README.md`。実際に壁として効くのは②だけで、他は説明。だが説明がずれると、次に触るときに②を間違える。

---

## 禁止事項

`.claude/settings.json` の `deny` が正本。要点：

- PRのマージとレビュー承認（`gh pr merge` / `gh pr review`）
- `gh api` / `gh repo edit` / `gh ruleset` / `curl` / `wget` — 上のガードレールを迂回する経路
- force push、`git reset --hard`、`git commit --amend`、`main` への直接push
- `.env` と秘密鍵の読み取り
- `codex login` / `logout` — 認証先をサブスクからAPIキー（従量課金）に差し替えられる経路
- `codex` のサンドボックス回避（`--dangerously-bypass-*`、`danger-full-access`）

`deny` は全権限モードでも有効な唯一の層。禁止事項は必ず `deny` 側に書く（`allow` は緩めるための道具で、`bypassPermissions` では無効化される）。

---

## 進捗の記録

専用の台帳は持たない。進捗の正本はPR履歴。複数セッションにまたがるタスクだけ GitHub Issues を使う。
