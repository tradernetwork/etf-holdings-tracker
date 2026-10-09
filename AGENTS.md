# TickerTrace — Agent Context

This file helps AI agents (and future-me) get up to speed fast without reading the full codebase.

## What This Project Is

A financial intelligence dashboard that scrapes daily ETF holdings from 58 actively-managed ETFs (Avantis, ARK, YieldMax, REX Shares, Kurv, Tidal, Corgi Funds), diffs them, and shows retail investors what changed. Frontend on Vercel (Next.js), API on Vultr (FastAPI + Docker), data files in git.

## Key People / Context

- **Owner:** Sam (mphinance, <mphanko@gmail.com>)
- **GitHub repo:** `mphinance/etf-holdings-tracker`
- **Stripe account:** Connected, pro tier is `$15/mo`
- **Firebase project:** `ticker-trace` (Google/email auth)

## Critical Files to Know

| File | Purpose |
|------|---------|
| `scrape_avantis.py` | Daily scraper — all 15 ETFs |
| `cusip_lookup.py` | CUSIP → ticker resolver |
| `api/server.py` | FastAPI app — all routes |
| `api/data.py` | Python data layer — reads CSVs |
| `api/auth.py` | SQLite user/API key management |
| `etf-dashboard/lib/holdings.ts` | Frontend data layer — mirrors data.py |
| `etf-dashboard/lib/firebase.ts` | Firebase SDK config |
| `etf-dashboard/components/auth-context.tsx` | Auth state — `API_BASE` URL here |
| `data/cusip_cache.json` | ~1200 cached CUSIP resolutions |
| `data/holdings.db` | SQLite DB (positions + changes) |

## Infrastructure State (as of May 16, 2026)

- **Frontend:** `tickertrace.pro` and `www.tickertrace.pro` → Vercel
- **API:** `api.tickertrace.pro` → **vultr** `149.28.104.163`, port 443 via Apache, Docker container `tickertrace-api` on port 8100
- **SSH alias:** `ssh vultr` (root@149.28.104.163:22). This used to be `ssh newvultr`, because `vultr` once pointed at a different box (207.148.19.144). The ssh config has since been consolidated: `vultr` now resolves to 149.28.104.163 and no `newvultr` host exists any more.
- **Repo on server:** `/home/mphinance/TickerTrace`
- **Apache** handles SSL termination (NOT nginx)
- **Let's Encrypt cert** for `api.tickertrace.pro` at `/etc/letsencrypt/live/api.tickertrace.pro/`
- **Firebase service account:** `/home/mphinance/TickerTrace/api/firebase-service-account.json` (host) mounted into Docker at `/app/firebase-service-account.json` — NOT in git
- **Auth gates:** All ProGate walls removed as of May 2026 — all features are open access. `pro-gate.tsx` is a passthrough.

## Common Operations

### Deploy API changes

```bash
# From local machine:
git push origin main
ssh vultr "cd /home/mphinance/TickerTrace && git stash && git pull origin main && docker compose build --no-cache api && docker compose up -d api"
```

### Run manual scrape

```bash
ssh vultr "cd /home/mphinance/TickerTrace && docker run --rm \
  -v /home/mphinance/TickerTrace:/work -w /work python:3.12-slim \
  bash -c 'pip install -q beautifulsoup4 pandas requests yfinance lxml && python3 scrape_avantis.py'"

# Then copy output and restart:
ssh vultr "cd /home/mphinance/TickerTrace && \
  cp normalized_holdings.csv etf-dashboard/public/data/holdings_latest.csv && \
  cp normalized_holdings.csv etf-dashboard/public/data/history/holdings_\$(date +%Y-%m-%d).csv && \
  docker compose restart api"
```

### Quick API health check

```bash
curl -sk https://api.tickertrace.pro/health
curl -sk https://api.tickertrace.pro/api/v1/funds | python3 -m json.tool | head -20
```

## User Preferences

- **Browser automation:** Use **Playwright** (Python `playwright` library) for any web scraping or browser automation tasks. Do NOT use the built-in browser tool — it gets stuck in loops. Write a Python script and run it via terminal instead.

## Known Gotchas (DO NOT REPEAT THESE MISTAKES)

1. **NEVER run Python scripts directly on the vultr host** — use Docker (`python:3.12-slim`).

2. **Use `ssh vultr`** — it resolves to 149.28.104.163, the box this project runs on. This entry used to say the opposite (use `newvultr`, avoid `vultr`) and was correct at the time; the ssh config has since been consolidated, so `ssh newvultr` now fails outright. The repo path is `/home/mphinance/TickerTrace`.

3. **NEVER try to install nginx on vultr** — Apache is already running on port 80. Use Apache vhosts.

3. **git stash before git pull on server** — server CSVs and Firebase debug logs create local changes.

4. **Docker data volume is mounted read-only** (`ro` in docker-compose). Scraper writes to HOST filesystem, not inside container. Container reads updated files on next request (no restart needed for data updates, but restart IS needed for code changes).

5. **ETF Ticker column** — some source CSVs use internal names (`REX_ULTI`, account codes). Scraper now unconditionally sets `ETF Ticker = config ticker`. Don't revert this.

6. **T-bill CUSIPs** — YieldMax funds (ULTY, SLTY) hold T-bills as collateral. These show up as 9-char CUSIPs like `912797RG4`. They're now filtered via `_is_junk_ticker()` in `data.py`. Don't show them to users.

7. **Firebase browser automation** — The AI cannot reliably interact with the Firebase console in a browser. Give the human instructions instead.

8. **Stripe checkout URL** — hardcoded in `auth-modal.tsx`. Make sure it points to `api.tickertrace.pro`, not `localhost`.

9. **`/changes` page** — was behind ProGate, now public. Share buttons added for X, Reddit, Discord.

10. **CUSIP lookup** — `cusip_lookup.py` uses OpenFIGI API (free, no key needed). Cache first, API fallback. Cache file must be at `data/cusip_cache.json` relative to project root.

## Data Flow (Detailed)

> **Canonical reference:** [`docs/PIPELINE.md`](docs/PIPELINE.md) — full scrape →
> normalize → ETL walkthrough with function/line anchors.

```
Source CSV/HTML
    → scrape_avantis.py fetches raw data
    → normalize_columns() renames columns to standard names
    → ETF Ticker ALWAYS set to config ticker (not source value)
    → CUSIP lookup resolves unknown tickers
    → DataFrame written to SQLite (holdings.db)
    → All funds merged into normalized_holdings.csv
    → normalized_holdings.csv copied to:
        etf-dashboard/public/data/holdings_latest.csv   (Next.js reads this)
        etf-dashboard/public/data/history/holdings_YYYY-MM-DD.csv  (API reads these)
    → git push (Vercel auto-deploys frontend)
    → docker compose restart api  (Docker picks up new history file)
```

## Auth Flow

```
User clicks Google Sign In
    → Firebase SDK (in browser) → Google OAuth
    → Firebase ID token generated
    → POST /auth/firebase-login {idToken}
    → Backend verifies token via Firebase Admin SDK
    → Finds or creates user in SQLite by email
    → Returns {apiKey, tier, email}
    → Frontend stores apiKey in localStorage
    → All API calls include X-API-Key header
```

## Adding a Fund — Quick Checklist

Use slash command `/add-fund` for the full workflow. Quick version:

- [ ] `scrape_avantis.py` FUNDS list
- [ ] `api/data.py` FUND_PROVIDERS + FUND_AUM
- [ ] `etf-dashboard/lib/holdings.ts` FUND_PROVIDERS + FUND_AUM
- [ ] Test scrape locally
- [ ] Deploy + verify API endpoint

## Commit Style — "Patch Notes from the Trenches"

Every commit message should use the "Patch Notes from the trenches" voice — conversational, slightly self-deprecating, real. This isn't a corporate changelog. Think dev blog update, not JIRA ticket. Examples:

```
feat: add share buttons to dashboard, fix all stale vercel URLs

- Added X/Twitter and Reddit share buttons next to Discord webhook on dashboard
- Updated all ticker-trace.vercel.app references to tickertrace.pro
- Because apparently we shipped the old URL and nobody noticed for weeks

fix: strip ULTI tickers back to actual symbols

- REX Shares CSVs use internal account names as "Ticker"
- Scraper now unconditionally sets ETF Ticker = config ticker
- The Hall of Shame grows
```

**Always use this voice in commit messages.** The format is: `type: short description` + bullet points with context.

## Public API Spec (`/openapi.json`)

The spec is generated live by FastAPI at `https://api.tickertrace.pro/openapi.json`
(proxied same-origin at `https://tickertrace.pro/openapi.json`). There is no committed
snapshot. **It must ONLY contain public data endpoints** (`/api/v1/*`). Never include:

- Auth endpoints (`/auth/*`)
- Billing endpoints (`/billing/*`)
- Internal/legacy routes (visit tracking, redirects)

Hide anything non-public with `include_in_schema=False` on the route. Agent-facing
docs live in `etf-dashboard/public/llms.txt` (served at `/llms.txt` on both domains).
