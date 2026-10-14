#!/usr/bin/env bash
# Push the scrape commit to main, surviving main moving underneath us.
#
# The scrape job runs ~90 min, so merged PRs routinely land on main before the
# push. A plain push then dies "fetch first". The old retry ran `git pull --rebase`,
# which refuses to run with ANY unstaged tracked change (scraper by-products) and
# killed the job, so the day's holdings never landed.
#
# Usage: scripts/push_holdings.sh [branch] [max_attempts] [base_sleep_seconds]
# Expects the scrape commit to already be HEAD. Data paths are the only thing the
# commit touches; if a rebase conflicts on them we re-take OUR freshly scraped files.
set -u

DATA_PATHS=(normalized_holdings.csv etf-dashboard/public/data analyses)

push_with_retry() {
  local branch="${1:-main}" max="${2:-5}" base="${3:-5}" attempt ours
  ours=$(git rev-parse HEAD)
  for attempt in $(seq 1 "$max"); do
    if git push origin "HEAD:${branch}"; then
      echo "Pushed on attempt ${attempt}."
      return 0
    fi
    echo "Push attempt ${attempt} rejected: rebasing on origin/${branch} and retrying..."
    git fetch origin "$branch" || { sleep $((base * attempt)); continue; }
    # Leftover by-products (modified/untracked, not part of the commit) must not block the rebase.
    git stash push -u -m scrape-retry >/dev/null 2>&1 || true
    # -X theirs inside a rebase means the commit being replayed (ours): freshly scraped data wins.
    if ! git rebase -X theirs "origin/${branch}"; then
      echo "Rebase failed; re-applying the scraped data on top of origin/${branch}."
      git rebase --abort 2>/dev/null || true
      git reset --hard "origin/${branch}"
      git checkout "$ours" -- "${DATA_PATHS[@]}" 2>/dev/null || true
      git add -A -- "${DATA_PATHS[@]}"
      git commit -m "$(git log -1 --format=%s "$ours")" || true
    fi
    sleep $((base * attempt))
  done
  echo "::error::Failed to push holdings after ${max} attempts."
  return 1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  push_with_retry "$@"
fi
