# test_02

個人開発でAIを自走させるための最小構成の開発環境。

安全性を人間の都度承認ではなく、GitHub側の機械的な壁で担保する。AIはブランチ上で自由に
実装しPRを作れるが、マージ権は持たない。マージしてよいかは、変更されたパスに基づいて
GitHubが判定する。

```
feature ブランチで実装 → push → PR作成        （すべて承認不要）
                                  │
                                  ▼
                   automerge.yml が自動マージを予約
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        ▼                                                   ▼
  保護パス外 かつ CI green                          保護パスを含む
        │                                                   │
        ▼                                                   ▼
    自動マージ                                    人間がマージするまで待機
```

**保護パス:** `.github/`、`.claude/`、`CLAUDE.md`

判定しているのは `automerge.yml`。保護パスを含むPRには自動マージを予約しない。AIは
`gh pr merge` を持たないため、予約されなければマージ経路が存在しない。

`CODEOWNERS` は壁ではない。作成者が唯一のコードオーナーだとGitHubは本人にレビューを
要求しないので、`require_code_owner_review` は実質的に無効化される。

## 構成

| ファイル | 役割 |
|---|---|
| `CLAUDE.md` | プロジェクト概要・開発フロー・保護パス・委任基準 |
| `.claude/settings.json` | モデル割り当て（Opus/Sonnet）と権限（allow/deny） |
| `.github/CODEOWNERS` | レビュー要求の宛先（壁ではない） |
| `.github/workflows/automerge.yml` | 保護パスを判定し、含まないPRにのみ自動マージを予約する |
| `.github/workflows/ci.yml` | 秘密情報スキャン |

保護パスの定義は3か所に写っている。**片方だけ変えると穴が開く。**
①`CLAUDE.md` の表、②`automerge.yml` の grep パターン、③`.github/CODEOWNERS`。

## GitHub側の設定

| 設定 | 内容 | bypass |
|---|---|---|
| ルールセット `main-ci` | 必須チェック（秘密情報スキャン）、ブランチ削除禁止、非早送り禁止 | なし。管理者もCIを飛ばせない |
| ルールセット `main-review` | コードオーナー承認（承認数0＋パス単位） | 管理者のみ `pull_request` |
| リポジトリ設定 | auto-merge有効、squashマージのみ、マージ後ブランチ削除 | — |

ルールセットを2本に分けているのは、bypass がルールセット単位でしか設定できないため。
1本に統合すると、管理者bypassがCIにも効いてしまい、green を待たずにマージできる状態になる。

`main-review` の `pull_request` ルールは main への直接pushも止める。`bypass_mode` が
`pull_request` なので、管理者のbypassはPR経由のマージにのみ効き、直接pushには効かない。

### 再構築する場合

```bash
gh api -X PATCH repos/rikunishi45/test_02 \
  -F allow_auto_merge=true -F allow_squash_merge=true \
  -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true

gh api -X POST repos/rikunishi45/test_02/rulesets --input .github/rulesets/main-ci.json
gh api -X POST repos/rikunishi45/test_02/rulesets --input .github/rulesets/main-review.json
```

`gh api` はAIの `deny` 対象。ガードレールを迂回する経路のため、人間が実行する。
