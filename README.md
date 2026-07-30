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

**保護パス:** `.github/`、`.claude/`、`CLAUDE.md`（`.github/CODEOWNERS` が正本）

## 構成

| ファイル | 役割 |
|---|---|
| `CLAUDE.md` | プロジェクト概要・開発フロー・保護パス・委任基準 |
| `.claude/settings.json` | モデル割り当て（Opus/Sonnet）と権限（allow/deny） |
| `.github/CODEOWNERS` | 人間のマージ承認が必要なパス |
| `.github/workflows/automerge.yml` | 全PRに自動マージを予約する |
| `.github/workflows/ci.yml` | 秘密情報スキャン |

## GitHub側の設定

- ルールセット `main-ci` — 必須チェック、ブランチ削除禁止、非早送り禁止
- ルールセット `main-review` — コードオーナー承認（管理者は `bypass_mode: pull_request`）
- リポジトリ設定 — auto-merge有効、squashマージのみ、マージ後ブランチ削除
