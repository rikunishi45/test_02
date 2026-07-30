#!/usr/bin/env bash
#
# 新規リポジトリにGitHub側の設定を投入する。リポジトリ作成直後に1回だけ実行する。
#
# gh api はAIの deny 対象（ガードレールを迂回する経路のため）。これは人間が実行する。
# このファイル自体も保護パス。AIが書き換えられると、人間の手で任意の gh api が走る。
#
# 冪等。既に存在するルールセットはスキップするので、再実行しても壊れない。
#
set -euo pipefail

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
VISIBILITY="$(gh repo view --json visibility -q .visibility)"

echo "対象: $REPO ($VISIBILITY)"

if [ "$VISIBILITY" != "PUBLIC" ]; then
  echo >&2
  echo "エラー: private では無料プランのルールセットAPIが403を返す。" >&2
  echo "サーバー側の壁が丸ごと消えるため、この構成は public を前提にしている。" >&2
  exit 1
fi

echo
echo "== リポジトリ設定 =="
gh api -X PATCH "repos/$REPO" \
  -F allow_auto_merge=true \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true >/dev/null
echo "  auto-merge有効 / squashのみ / マージ後ブランチ削除"

echo
echo "== ルールセット =="
# .github/rulesets/*.json が正本。既存のものは更新する（スキップしない）。
# スキップにすると、必須チェックを足したときにファイルとGitHub側がずれる。
#
# 注意: 必須チェックを追加する場合、対応するジョブが main の ci.yml に
# 入ってからこれを実行すること。逆順にすると、報告されないチェックを
# 待ち続けて全PRがマージ不能になる。
for f in .github/rulesets/*.json; do
  name="$(basename "$f" .json)"
  id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id")"
  if [ -n "$id" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$id" --input "$f" >/dev/null
    echo "  $name — 更新した"
  else
    gh api -X POST "repos/$REPO/rulesets" --input "$f" >/dev/null
    echo "  $name — 作成した"
  fi
done

echo
echo "完了。現在のルールセット:"
gh api "repos/$REPO/rulesets" --jq '.[] | "  \(.name)  \(.enforcement)"'
