#!/usr/bin/env bash
#
# codex-triage が codex exec review を実行するたびに呼ぶ。
# codex-review-log.jsonl（リポジトリルート、非保護パス）に1行追記する。
#
# このログは観測用途のみ。「レビューが実際に行われた証明」としては使わない
# （書いているのが Claude 自身である以上、その用途には使えない）。
#
set -euo pipefail

scope="${1:?scope required (e.g. uncommitted, base:main)}"
real_fixes="${2:?real_fixes count required}"
nitpicks="${3:?nitpicks count required}"
false_positives="${4:?false_positives count required}"

REPO_ROOT="$(git rev-parse --show-toplevel)"

jq -nc \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg scope "$scope" \
  --argjson real_fixes "$real_fixes" \
  --argjson nitpicks "$nitpicks" \
  --argjson false_positives "$false_positives" \
  '{
    timestamp: $ts,
    scope: $scope,
    real_fixes: $real_fixes,
    nitpicks: $nitpicks,
    false_positives: $false_positives
  }' >> "$REPO_ROOT/codex-review-log.jsonl"
