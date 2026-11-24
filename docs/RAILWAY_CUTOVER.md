# Railway cutover plan: api.tickertrace.pro

Status: PLAN ONLY. Nothing here has been executed. Written 2026-11-24.

## Why

The Vultr box (3.9GB RAM, 8GB swap crutch) shares memory with Apache and five unrelated sites. The API idles at ~1.1GB and peaks higher on rebuilds. Only the API leaves the box; Vultr is not decommissioned.

## Recommended architecture

One Railway service `tickertrace-api` (already exists in project `traderdaddypro-options`, builds from this repo's Dockerfile) plus one Railway volume and one cron service. Keep SQLite on the volume for now.

```
GitHub Actions scrape -> commits CSVs to main
        |                          |
        |                  Railway auto-build on push (image includes CSVs)
        v
 api.tickertrace.pro (Railway edge) -> uvicorn :$PORT (1 worker)
                                       volume /app/api/data (SQLite + stock index)
```

## Data delivery for CSVs

Facts: `api/data.py` reads `HISTORY_DIR = <repo>/etf-dashboard/public/data/history` (194 files, 327MB). Vultr mounts that from the git tree read-only. The Dockerfile only does `mkdir -p` there, so a Railway build today ships NO holdings.

Options:

| Option | How | Cost |
|---|---|---|
| **A. Bake into image (recommended)** | Add `COPY etf-dashboard/public/data/ etf-dashboard/public/data/` to the Dockerfile. Every nightly scrape commit already triggers a Railway build, so data ships with code. | 327MB image layer, rebuild every scrape (~2 to 4 min). Zero new moving parts. Redeploy swaps the container, so the in-memory caches rewarm (the disk-persisted stock index lives on the volume, so that is cheap). |
| B. Volume + sync job | Volume mounted at the data dir, cron service does `git pull`. | Second writer, drift risk, the exact failure class that froze prod in July. |
| C. Object storage | Move CSVs to a Railway bucket, change `api/data.py` reads. | Code change in the hot path. Not for a cutover. |

Go with A. Two details to handle: (1) the `.dockerignore` must not exclude the data dir, and the Dockerfile COPY must stay in `REBUILD_RE` in `sync_data.sh` (the guard test covers it, and the Vultr rebuild trigger keeps working during the warm period). (2) Railway builds on every push to main, including the daily data commits. Consider a watch path of `api/**`, `Dockerfile`, `effectiveness.py`, `cboe_scanner.py`, `etf-dashboard/public/**` so unrelated mobile or dashboard commits do not rebuild the API.

## SQLite migration

State in `api/data/` (gitignored, Vultr bind mount `./api/data:/app/api/data`): `tickertrace.db` (users, API keys, promo codes, visits, usage, notification receipts; sqlite3 is used by `auth.py`, `visits.py`, `usage.py`, `notification_store.py`, `notifications.py`) and `stock_index_*.pkl` (rebuildable cache).

Recommended: keep SQLite, attach a Railway volume at `/app/api/data`, copy the db once during the maintenance window.
- A volume pins the service to one replica and causes a few seconds of downtime per deploy (volume remount). Acceptable for a read-mostly open API; this is the main cost of the choice.
- Copy procedure (human, at cutover): on Vultr `sqlite3 tickertrace.db ".backup /tmp/tt.db"` (consistent snapshot, do not `cp` a live WAL db), then upload to the Railway volume via `railway ssh` or a one-off service command. Never commit it.
- Visits and usage writes between snapshot and DNS flip are lost on Railway. Visits are analytics only; check whether API keys or promo redemptions can change in that window (see open questions).

Postgres (exists in that project) is the bigger change: five modules use raw `sqlite3`, SQL dialect and connection handling differ, plus a data migration and tests. Do it later, not as part of this cutover.

## Notification worker replacement

Today `sync_data.sh` runs `python -m api.notification_job` every 15 minutes via `docker compose exec`, gated on `NOTIFICATIONS_ENABLED=1` in `api/.env`, after a healthy sync.

Problem: the worker writes receipts to the same SQLite file. A Railway cron service cannot mount the API's volume (a volume attaches to one service). So either:
1. Run the worker inside the API service (background task or a small loop started in lifespan, guarded by the existing in-container flock), or
2. Move receipts to Postgres first, then use a Railway cron service (`*/15 * * * *`, start command `python -m api.notification_job`).

Recommend 1 for the cutover (smallest change, one volume), 2 as the follow-up. Until the replacement is live, leave `NOTIFICATIONS_ENABLED` OFF on Railway and keep Vultr's worker running ONLY IF Vultr still holds the authoritative db. Never run both against separate dbs: users would get duplicate or missing digests. Decide who owns notifications at flip time (open question 3).

## Environment variable NAMES to set on Railway

Values are copied by the human from `api/.env` on Vultr. Never paste them into a PR, chat or log.

Read by the code: `ALLOWED_ORIGINS`, `TICKERTRACE_BASE_URL`, `ADMIN_TOKEN`, `NOTIFICATIONS_ENABLED`, `EXPO_ACCESS_TOKEN`, `OPENROUTER_API_KEY`, `RETAIL_FEED_URL`, `TICKERTRACE_INGEST_SECRET`, `VISIT_HASH_SALT`, `SCRAPE_RETRY_DELAYS`, `TT_PREWARM`, `STOCK_INDEX_CACHE_DIR`, `GIT_SHA`.

Railway specific:
- `GIT_SHA`: the Dockerfile sets it from the `GIT_SHA` build arg. Railway exposes `RAILWAY_GIT_COMMIT_SHA` as a service variable and passes service variables to the build as build args when the Dockerfile declares an `ARG` of the same name. Set `GIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}` and verify `/health` shows a real SHA after the first build. If it reads `unknown`, fall back to reading `RAILWAY_GIT_COMMIT_SHA` in `server.py` `/health` (one-line change) as a second source.
- `PORT`: Railway injects it. The Dockerfile CMD hardcodes 8100, so either set `PORT=8100` or change the CMD to `--port ${PORT:-8100}` (needs a shell form or `sh -c`).
- `STOCK_INDEX_CACHE_DIR=/app/api/data` (the volume).
- `VISIT_HASH_SALT` must match Vultr's value, or visitor hashes reset and unique counts jump.
- `ALLOWED_ORIGINS`: copy Vultr's list; confirm it contains `https://tickertrace.pro` and `https://www.tickertrace.pro`.

## Proxy trust and rate limiting (must be re-derived)

Vultr trusts only the Docker bridge (`--forwarded-allow-ips 172.16.0.0/12`) because Apache appends the client IP. On Railway the edge proxy talks to the container over its private network, from addresses that are not in 172.16.0.0/12 and that Railway does not publish as a stable range. Left as is, uvicorn ignores `X-Forwarded-For`, so every client shares the proxy's address: one rate-limit bucket for the whole internet and wrong visit hashes.

Do NOT use `*` blindly: it lets a client spoof its key if any path reaches the container without the proxy. Railway containers are only reachable through the edge (no public TCP unless a proxy is created), so `*` is defensible there, but only if (a) no TCP proxy exists for this service and (b) uvicorn takes the rightmost untrusted hop and Railway's edge appends the real client IP. Verify empirically before DNS flip (checklist below), using the `*.up.railway.app` URL with a forged `X-Forwarded-For`. Make the value an env var (`FORWARDED_ALLOW_IPS`, which uvicorn reads natively) rather than editing the CMD, so Vultr keeps its tight setting.

Rate limiter state is in-memory slowapi, one worker: it resets on every deploy, and every nightly data commit is a deploy. Acceptable; note it.

## Memory sizing

Vultr cap is `mem_limit: 2200m`, idle ~1.1GB, effectiveness peak ~0.56GB after #221, stock index rebuild peaks higher. Set the Railway service memory limit to 2GB minimum, 3GB comfortable. Check the workspace plan's per-service memory limit and pricing before committing (not verified here; this machine has no Railway access). No swap on Railway, so the 8GB swap crutch disappears; a spike over the limit is an OOM restart, not a slowdown. Watch the first week.

## DNS cutover

Current: `api.tickertrace.pro` A -> `149.28.104.163` (Vultr, Apache, Let's Encrypt). Railway already has the custom domain attached.

T-48h
1. Lower the TTL on the `api.tickertrace.pro` record to 60s. Wait out the old TTL.
2. Deploy to Railway with Dockerfile data COPY (option A), volume, env vars. Reach it only via `tickertrace-api-production.up.railway.app`.
3. Run the verification checklist against the Railway URL. Fix before continuing.

T-0 (low traffic window, after the evening scrape commit has landed on both)
4. Snapshot the SQLite db on Vultr, load it onto the Railway volume. Optionally set Vultr's `NOTIFICATIONS_ENABLED=0` to stop receipts diverging.
5. Change DNS (Railway shows the CNAME or A target for the attached custom domain; use exactly what the dashboard shows, and add the TXT verification record if requested). Keep the Vultr box untouched.
6. Wait for Railway to issue the certificate (`domain-status` shows it); until then HTTPS clients may see cert errors, so do step 5 only after the domain shows verified if Railway supports pre-verification.

T+1h
7. Run the checklist against `https://api.tickertrace.pro`. Watch Railway memory, 5xx rate, `/health` commit.
8. Keep TTL at 60s for 48h, then restore to a normal TTL.

## Verification checklist

Run against the Railway URL first, then the real domain.

- `/health` returns 200 and `commit` equals the current `origin/main` SHA (not `unknown`).
- `/api/v1/stats` `asOfDate` is within one business day.
- `python scripts/check_freshness.py https://tickertrace-api-production.up.railway.app` passes (it takes the base URL as argv[1]). Note the canary also needs `/health` commit matching `origin/main`.
- `/api/v1/signals` returns non-empty buying and selling lists; `fundsTracked` on stats equals the Vultr value (150 at last count).
- `/api/v1/stock/NVDA` returns in a few seconds cold and does not 502 (this was the OOM victim).
- `/api/v1/fund-effectiveness` returns, and memory stays under the limit.
- `/mcp`: `claude mcp add --transport http tickertrace-test <url>/mcp`, list tools, expect 22, call `get_signals`. Streamable HTTP must not be buffered or gzipped by the edge.
- CORS: `curl -H "Origin: https://tickertrace.pro" -i <url>/api/v1/signals` shows `access-control-allow-origin: https://tickertrace.pro`. Repeat for an origin NOT in the list and expect no ACAO header. Then load tickertrace.pro in a browser and confirm the dashboard populates.
- Rate limit keys: send requests with `X-Forwarded-For: 1.2.3.4` and then `5.6.7.8` (through the Railway edge) and confirm they land in different buckets and that a client-supplied prefix cannot choose its own bucket. Exceed the limit from one IP and confirm 429 for it but not for another.
- `etf-dashboard` API_BASE files (listed in CLAUDE.md) still point at `https://api.tickertrace.pro`; no change needed because the hostname is unchanged.
- Auth: register and login round trip on a throwaway account; confirm a pre-existing API key from the copied db still works.
- Gzip: `curl -H "Accept-Encoding: gzip" -I` on a large endpoint shows `content-encoding: gzip` once, not double-encoded by the edge.
- Cache-Control `public, max-age=300` present on signals, absent on `/health`.

## Rollback

Vultr stays warm and untouched (cron sync keeps its CSVs fresh, container keeps running, db frozen at snapshot time).
1. Set DNS back to `149.28.104.163` (60s TTL makes this a ~1 to 5 minute change).
2. If Railway took writes after the flip (new users, keys, visits), export them from the Railway volume and merge into Vultr's db, or accept the loss for analytics-only tables.
3. Re-enable `NOTIFICATIONS_ENABLED=1` on Vultr only if it was disabled.
Do not decommission the Vultr API container until at least two weeks of clean Railway operation.

## Things that change after cutover

- `sync_data.sh` keeps working for the Vultr copy only. After cutover it should stop rebuilding the API (or be removed from cron) to avoid a useless warm copy eating RAM; decide with the Vultr cleanup.
- `CLAUDE.md` deploy, Vultr and canary sections need rewriting: deploy is now "merge to main, Railway builds"; data freshness is now bounded by build time, not the 15 minute cron.
- The freshness canary default base stays correct (hostname unchanged).

## Open questions for the human

1. Plan: is the Railway workspace on Pro? Is 2 to 3GB per service acceptable on that bill, and who pays (Art's workspace)?
2. Can API keys, promo codes or user accounts change between the db snapshot and the DNS flip? If yes, schedule a short read-only freeze or accept loss.
3. Notifications: who owns the worker during and after the flip? Run it inside the API service (recommended) or wait for Postgres?
4. OK to bake 327MB of CSVs into the image and rebuild on every nightly data commit, and to add watch paths? Or is there a preference for a volume?
5. Is deploy downtime of a few seconds from a volume remount acceptable for the API and `/mcp`?
6. Proxy trust: confirm no TCP proxy will ever be attached to this service, so `FORWARDED_ALLOW_IPS=*` is acceptable, or provide the Railway edge range if it is documented for the account.
7. Do you want Postgres as a follow-up, which also unlocks a separate cron service?
8. Is `api.tickertrace.pro` the only hostname pointing at Vultr for this API, or do other clients use the raw IP or the old `api.tickertrace.mphinance.com`?
9. Where is the Let's Encrypt cert renewal for Vultr managed, and does anything else on Apache depend on the API vhost being present?
