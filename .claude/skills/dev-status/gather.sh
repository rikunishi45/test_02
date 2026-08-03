#!/usr/bin/env bash
#
# 開発環境の状態を gh/git から集計し、1個のJSONにまとめて標準出力に返す。
# 新しい記録場所は作らない（PR履歴・CI履歴・gitログが正本）。
# 唯一の例外は codex-review-log.jsonl（リポジトリルート、非保護パス）で、
# これだけは「実行のたびの正確な件数」が履歴からは導出できないため、
# 別途 codex-triage が書き足している観測ログを読む。
#
set -euo pipefail

PROTECTED_RE='^(\.github/|\.claude/|CLAUDE\.md$|AGENTS\.md$|setup-github\.sh$|run-tests\.sh$)'
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ---------- 1. PRのマージ状況 ----------
pr_list=$(gh pr list --state all --limit 200 --json number,title,state,createdAt,mergedAt,url)

pr_with_files="[]"
for n in $(echo "$pr_list" | jq -r '.[].number'); do
  files=$(gh pr view "$n" --json files --jq '[.files[].path]' 2>/dev/null || echo '[]')
  entry=$(jq -n --argjson n "$n" --argjson files "$files" '{number: $n, files: $files}')
  pr_with_files=$(echo "$pr_with_files" | jq --argjson e "$entry" '. + [$e]')
done

prs=$(jq -n --argjson list "$pr_list" --argjson files "$pr_with_files" --arg re "$PROTECTED_RE" '
  $list | map(
    . as $pr
    | ($files[] | select(.number == $pr.number) | .files) as $f
    | $pr + {
        files: $f,
        protected: ([$f[] | select(test($re))] | length > 0)
      }
  )
')

# ---------- 2. CIの健康度 ----------
runs=$(gh run list --workflow=ci.yml --limit 200 --json databaseId,conclusion,createdAt,headBranch)

job_results="[]"
for id in $(echo "$runs" | jq -r '.[].databaseId'); do
  jobs=$(gh run view "$id" --json jobs --jq '[.jobs[] | {name: .name, conclusion: .conclusion}]' 2>/dev/null || echo '[]')
  entry=$(jq -n --argjson id "$id" --argjson jobs "$jobs" '{run: $id, jobs: $jobs}')
  job_results=$(echo "$job_results" | jq --argjson e "$entry" '. + [$e]')
done

ci_jobs=$(echo "$job_results" | jq '[.[].jobs[]]')

# ---------- 3. codex-review 利用実績（観測ログ由来） ----------
if [ -f codex-review-log.jsonl ] && [ -s codex-review-log.jsonl ]; then
  codex_log=$(jq -s '.' codex-review-log.jsonl)
else
  codex_log="[]"
fi

# ---------- 4. 技術スタックの変遷 ----------
stack_cycles=$(git log --diff-filter=A --oneline -- run-tests.sh | wc -l | tr -d ' ')
stack_active="false"
[ -f run-tests.sh ] && stack_active="true"

# commit subjectに引用符等が含まれてもJSONを壊さないよう、jq -n の変数展開に通す
added_events=$(git log --diff-filter=A --format='%H|%ad' --date=short -- run-tests.sh | while IFS='|' read -r hash date; do
  subject=$(git log -1 --format='%s' "$hash")
  jq -n --arg date "$date" --arg subject "$subject" '{date: $date, subject: $subject}'
done | jq -s '.')

removed_events=$(git log --diff-filter=D --format='%H|%ad' --date=short -- run-tests.sh | while IFS='|' read -r hash date; do
  subject=$(git log -1 --format='%s' "$hash")
  jq -n --arg date "$date" --arg subject "$subject" '{date: $date, subject: $subject}'
done | jq -s '.')

# ---------- まとめ ----------
jq -n \
  --argjson prs "$prs" \
  --argjson ci_jobs "$ci_jobs" \
  --argjson codex_log "$codex_log" \
  --argjson stack_cycles "$stack_cycles" \
  --argjson stack_active "$stack_active" \
  --argjson added_events "$added_events" \
  --argjson removed_events "$removed_events" \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    generated_at: $generated_at,
    prs: $prs,
    ci_jobs: $ci_jobs,
    codex_review_log: $codex_log,
    tech_stack_verification_cycles: $stack_cycles,
    tech_stack_currently_active: $stack_active,
    tech_stack_events: {added: $added_events, removed: $removed_events}
  }'
