#!/usr/bin/env bash
#
# sync_data.sh — keep the live API box in sync with origin/main, with no
# human (and no GitHub Actions SSH secrets) in the loop.
#
# WHY THIS EXISTS
# ---------------
# The daily GitHub Actions scrape commits fresh holdings CSVs to the repo,
# but this box reads CSVs from its OWN working tree. That tree only advanced
# on a manual deploy, so between deploys production froze on stale data while
# the repo marched on. A root cron already called this script every weekday —
# but the file itself didn't exist (it had been wiped by a `git clean -fd`
# during a hand deploy, since it was never committed), so every run failed
# with "sync_data.sh: not found" and the box silently rotted. This is that
# missing script, now committed so `git clean` can't delete it again.
#
# WHY ff-only (not reset --hard)
# ------------------------------
# This box is a pure downstream MIRROR: it never commits, so a fast-forward
# always applies cleanly. ff-only is deliberate — if someone ever leaves
# tracked local edits on the box, we log and bail rather than nuke their work
# the way `reset --hard` would.
#
# The API re-reads CSVs per request (no in-memory cache), so a moved tree
# serves fresh data with no rebuild; `docker compose up -d` just ensures the
# container is alive. The closing health check is a freeze alarm: if the API
# is down it lands in the log instead of being discovered a week later.
#
set -uo pipefail

REPO="/home/mphinance/TickerTrace"
ts() { date -u +%FT%TZ; }

cd "$REPO" || { echo "$(ts) FATAL: cannot cd $REPO"; exit 1; }

# Serialize sync and its out-of-process digest worker across overlapping cron runs.
exec 9>/var/lock/tickertrace-sync.lock
flock -n 9 || exit 0
notifications() {
  # Disabled-by-default worker is a cheap no-op. Poll tickets/retry outbox even
  # when git is already current; no job runs in either uvicorn worker.
  docker compose exec -T api python -m api.notification_job \
    || echo "$(ts) warning: notification worker failed; next sync will retry"
}

git fetch --quiet origin main || { echo "$(ts) git fetch failed"; exit 1; }

# The box must sit on `main` for the ff-only merge below to be possible at all.
# If someone debugs on the box and leaves it on a feature branch, that branch has
# commits main doesn't, so origin/main can NEVER fast-forward into it — the merge
# below fails identically every 15 minutes and production freezes on whatever
# data that branch happened to carry. That is not hypothetical: a `docs/` branch
# left checked out here froze the live API on 8-day-old holdings while every
# scrape stayed green. A branch checkout holds no work when the tree is clean
# (the commits are safe on their own ref), so returning to main is lossless and
# we do it automatically. If there ARE tracked edits, someone is mid-surgery —
# fall through to the same log-and-bail we use below rather than discard them.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "$(ts) on branch '$BRANCH' with uncommitted tracked edits — refusing to switch back to main; production is FROZEN until a human resolves this"
    exit 1
  fi
  git checkout --quiet main || { echo "$(ts) FATAL: cannot checkout main from '$BRANCH'"; exit 1; }
  echo "$(ts) box was parked on '$BRANCH' (clean tree) — returned to main"
fi

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  if curl -sf http://localhost:8100/health >/dev/null; then
    notifications
  fi
  exit 0
fi

if ! git merge --ff-only origin/main; then
  echo "$(ts) ff-only merge BLOCKED (tracked local edits on the box?) — not forcing; HEAD still ${LOCAL:0:7}"
  exit 1
fi

# Data CSVs are volume-mounted (read live, no rebuild needed), but the API
# code is baked into the image via `COPY api/`. So a pull that only moves data
# just needs `up -d`, while a pull that touches api/, the Dockerfile, or the
# compose file (or etf-dashboard/public/llms.txt, which the Dockerfile COPYs in)
# needs a rebuild — otherwise code changes silently never deploy
# (the same "green but not live" trap that froze the data). A failed build
# leaves the existing container running untouched, so this is safe to automate.
if git diff --name-only "$LOCAL" "$REMOTE" | grep -qE '^(api/|Dockerfile|docker-compose\.yml|etf-dashboard/public/llms\.txt)'; then
  echo "$(ts) code changed in api/ — rebuilding image"
  GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --build >/dev/null 2>&1 \
    || { echo "$(ts) BUILD FAILED — existing container left running"; exit 1; }
else
  docker compose up -d >/dev/null 2>&1 || echo "$(ts) warning: 'docker compose up -d' returned non-zero"
fi
sleep 5
if curl -sf http://localhost:8100/health >/dev/null; then
  echo "$(ts) synced ${LOCAL:0:7} -> ${REMOTE:0:7}; API healthy"
  notifications
else
  echo "$(ts) synced ${LOCAL:0:7} -> ${REMOTE:0:7} but API HEALTH CHECK FAILED"
  exit 1
fi
