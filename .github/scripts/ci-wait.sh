#!/usr/bin/env bash
# Waits for the CI runs of the pushed commit and prints a short summary (one line per job, the
# first errors of a failed job, the published versions). Run it in the background after `git push`.
#
#   bash .github/scripts/ci-wait.sh [commit]      default: HEAD
set -uo pipefail

REPO=${CI_REPO:-thatkerimguy/KerimsPluginRepo-Experimental}
SHA=$(git rev-parse "${1:-HEAD}")
INDEX=https://thatkerimguy.github.io/${REPO#*/}/index.json

# The runs can take a few seconds to appear after the push
for _ in $(seq 1 12); do
    runs=$(gh run list -R "$REPO" -L 10 --json databaseId,workflowName,headSha \
        --jq ".[] | select(.headSha == \"$SHA\") | \"\(.databaseId)|\(.workflowName)\"")
    [ -n "$runs" ] && break
    sleep 5
done
[ -z "$runs" ] && { echo "No CI runs found for ${SHA:0:7}"; exit 1; }

failed=0
while IFS='|' read -r id name; do
    gh run watch "$id" -R "$REPO" --exit-status --interval 20 >/dev/null 2>&1
    conclusion=$(gh run view "$id" -R "$REPO" --json conclusion --jq .conclusion)
    echo "$name: $conclusion"
    gh run view "$id" -R "$REPO" --json jobs --jq '.jobs[] | "  " + .name + ": " + (.conclusion // .status)'
    if [ "$conclusion" != "success" ]; then
        failed=1
        gh run view "$id" -R "$REPO" --log-failed 2>/dev/null | grep -E "e: |error|Error|FAIL|✖" | cut -c1-200 | head -20
    fi
done <<< "$runs"

# GitHub Pages can lag a minute behind the publish run
if grep -q "Publish" <<< "$runs" && [ "$failed" = 0 ]; then
    sleep 30
    curl -s "$INDEX?t=$(date +%s)" | python -I -c "import json,sys
d=json.load(sys.stdin)['plugins']
print('published: ' + ', '.join(f\"{k.split('.')[-1]} {v['channels']['latest']}\" for k,v in d.items()))"
fi
exit $failed
