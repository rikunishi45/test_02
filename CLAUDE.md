# test_02 — CLAUDE.md

@AGENTS.md

## プロジェクト概要

**目的：** 個人開発でAIを自走させるための最小構成の開発環境。安全性は人間の都度承認ではなく、GitHub側の機械的な壁で担保する。
**Status:** active
**作成日：** 2026-07-30

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| 言語 | TypeScript |
| テストランナー | Vitest（`vitest.config.ts` で閾値を固定） |
| ミューテーションテスト | Stryker（`stryker.config.mjs` で閾値を固定） |
| CI | GitHub Actions |

技術固有の規約は `.claude/rules/typescript.md`（`paths:` 付きで `*.ts`/`*.tsx` を
編集する時だけ読み込まれる）。ここ（グローバル）と `AGENTS.md` は技術非依存のまま保つ。

---

## テストの壁（`run-tests.sh`）

`src/` は保護パスではない。人間のレビューが入らないため、**CIのテストが唯一の壁**になる。

CIの `テスト` ジョブは fail closed で動く：

| 状況 | 結果 |
|---|---|
| `run-tests.sh` がある | 実行する。落ちればマージされない |
| `run-tests.sh` が無く `src/` も無い | 通る（現在の状態） |
| `run-tests.sh` が無いのに `src/` がある | **失敗する** |

実行権限（`chmod +x`）を忘れるとCIが落ちる。現在の中身：

```bash
#!/usr/bin/env bash
set -euo pipefail
npm ci --ignore-scripts
npx tsc --noEmit
npx vitest run --coverage
npx stryker run
```

型チェック → 単体テスト（カバレッジ） → ミューテーションテストの3段。

`run-tests.sh` は保護パス。実行順序はAIが変えられない。しきい値自体は
`vitest.config.ts` / `stryker.config.mjs`（どちらも保護パス）にある。**Strykerの
`thresholds` はCLIから上書きできず設定ファイルにしか書けない**ため、この2ファイルを
保護しないとカバレッジ・ミューテーションスコアの下限をAIが下げられてしまう。
`run-tests.sh` は `npm test` のような `package.json` 経由の間接呼び出しを使わず、
`npx` で直接コマンドを呼ぶ。それでも `package.json` / `package-lock.json` は
`run-tests.sh` が呼ぶツール（Vitest/Stryker）そのもののバージョンを決めるので、
**この2ファイルも保護パスにしてある**（非保護のままだと、しきい値ファイルを一切
変えずにツールのバージョンを差し替えて壁を弱められる。push前レビューで実際に
Codexに指摘された）。`--ignore-scripts` は依存パッケージの `postinstall` 等による
任意コード実行を塞ぐ。テスト本体（`src/**/*.test.ts`）は保護しないので自由に
追加・修正してよい。

**以前はここで「実装に合わせた甘いテストを書いて通すことを防げない」と書いていたが、
ミューテーションテストの導入でこの穴は部分的に塞がった。** 実装に小さな変異を注入し、
テストがそれを検知（テストが落ちる）するかを機械的に確認する——テストが実装の分岐を
なぞっているだけで、実際には何も検証していない場合、ミューテーションスコアが下がり
CIが落ちる。ただし万能ではない：同値ミュータント（観測可能な違いを生まない変異）は
原理的にどんなテストでも検知できない。詳細は `.claude/rules/typescript.md`。

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
| `/vitest.config.ts` | カバレッジ閾値の定義。ここが下げられると壁が弱くなる |
| `/stryker.config.mjs` | ミューテーションスコアの閾値の定義。CLIから上書きできない仕様のため、ここを保護しないと閾値をAIが下げられる |
| `/package.json` | `run-tests.sh` が `npx` で直接呼ぶツール（Vitest/Stryker）のバージョンをここが決める。非保護のままだと、しきい値ファイルを一切変えずにツールのバージョンや依存を差し替えて壁を弱められる（Codexレビューで実際に指摘された） |
| `/package-lock.json` | 同上。`npm ci` が実際にインストールする内容を固定する |
| `/tsconfig.json` | `npx tsc --noEmit`（`run-tests.sh` 内）の挙動を決める。`strict` を外す、`include` を狭める等で型チェックの壁を弱められる（Codexレビューで指摘） |

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

**この環境自体の状態を見るには `/dev-status` を使う。** PRのマージ状況・CIの健康度・
codex-reviewの利用実績・技術スタックの変遷をダッシュボードとして表示する
（`.claude/skills/dev-status/`）。新しい記録場所は作らず、既存のPR履歴・CI履歴・
gitログを集計するだけの「ビュー」。

唯一の例外が `codex-review-log.jsonl`（リポジトリルート、非保護パス）。`codex-triage`
が実行のたびに1行追記する観測ログで、「実行回数」はPR履歴からは正確に導出できない
（pushの前にローカルで何度も回した分がPR本文には残らないため）ここだけの例外措置。
**検証・強制の道具ではない。**書いているのがAI自身である以上、「レビューが実際に
行われた証明」には使えない。あくまで人間が状況を把握するための参考情報。
