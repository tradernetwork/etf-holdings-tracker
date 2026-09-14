# CLAUDE.md — TickerTrace Agent Context

## What is TickerTrace?

TickerTrace tracks daily ETF holdings changes across institutional fund families (ARK Invest, Avantis, Kurv, YieldMax, REX Shares, NicholasX). It scrapes fund provider websites daily, normalizes the data, detects position changes, and surfaces conviction-scored trading signals.

> [!IMPORTANT]
> **Repo name is not the product name.** The product is **TickerTrace**. The GitHub
> repo is **`tradernetwork/etf-holdings-tracker`** — renamed 2026-09-03 for search
> discoverability (its description and topics were empty, so it was unreachable by
> GitHub search under any name) and transferred into the `tradernetwork` org. Old
> URLs redirect, so existing clones keep working.
>
> Unrelated and unchanged: the `/home/mphinance/TickerTrace` **filesystem path** on
> the Vultr box, which appears throughout this file. A GitHub rename does not touch
> it — do not "fix" those paths.

## Architecture

```
GitHub Actions (daily scraper) → CSV history → FastAPI REST API → Vultr
                                            → FastMCP server → AI agents
                                            → Next.js dashboard
```

## Live API

**Base URL**: `https://api.tickertrace.pro`

All endpoints are open — no API key or authentication required.

| Endpoint | What it returns |
|----------|----------------|
| `GET /api/v1/signals` | Top buying/selling signals with conviction scores |
| `GET /api/v1/changes?provider=ARK&direction=buying` | Filterable daily position changes |
| `GET /api/v1/fund/ARKK` | Fund detail — top holdings, options, AUM |
| `GET /api/v1/ticker/TSLA` | Cross-fund view — who's buying/selling this ticker |
| `GET /api/v1/sectors` | Sector-level weight flows |
| `GET /api/v1/divergences` | Cross-fund conflicts (same ticker, opposite directions) |
| `GET /api/v1/funds` | All tracked funds |
| `GET /api/v1/stats` | Global stats |
| `GET /docs` | Interactive Swagger docs |

## MCP Server

The FastMCP server (`api/mcp_server.py`) exposes the same data as MCP tools:

```bash
python -m api.mcp_server
```

Tools (20 — an AI agent should not see less than a human does on the dashboard/REST API):
`get_signals`, `get_changes`, `get_fund_detail`, `get_ticker_detail`, `get_sector_flow`,
`get_divergences`, `get_layering_patterns`, `get_market_summary`, `get_briefing`,
`get_institutional_flow`, `get_institutional_trend`, `get_holdings_changes`,
`get_stock_activity`, `list_all_funds`, `list_all_tickers`, `get_income_overview`,
`get_income_fund_detail`, `get_options_listings`, `get_signal_performance`, `get_global_stats`

### Claude Desktop Integration

```json
{
  "mcpServers": {
    "tickertrace": {
      "command": "python",
      "args": ["-m", "api.mcp_server"],
      "cwd": "/path/to/TickerTrace"
    }
  }
}
```

### Companion: Momentum MCP

For quant analysis beyond holdings — screening, technicals, options/IV,
backtesting — TickerTrace pairs with **Momentum MCP**
([github.com/mphinance/momentum-mcp](https://github.com/mphinance/momentum-mcp)),
a sister project that gives an AI agent a Bloomberg-style toolkit. Its
`options_analysis` tool is the implied-volatility source for the
option-income fund work.

> [!IMPORTANT]
> Run your own instance from that repo. The maintainer's live endpoint is
> configured locally as the `ghost-iv` MCP server and is **deliberately not
> committed** — never add the live URL to this repo.

## Key Files

| File | Purpose |
|------|---------|
| `scrape_avantis.py` | Main scraper — runs daily via GitHub Actions |
| `api/server.py` | FastAPI REST server with Stripe billing hooks |
| `api/mcp_server.py` | FastMCP server for AI agent integration |
| `api/data.py` | Shared data layer — CSV parsing, signal scoring, sector flow |
| `api/auth.py` | User management, API keys, promo codes (not required for data) |
| `etf-dashboard/lib/holdings.ts` | TypeScript data layer for the Next.js dashboard |
| `etf-dashboard/app/dashboard/page.tsx` | Main dashboard UI |
| `generate_analysis.py` | Auto-generated daily markdown analysis |

## Data Flow

> **Canonical pipeline reference:** [`docs/PIPELINE.md`](docs/PIPELINE.md) walks
> the full scrape → normalize → ETL path with function/line anchors. The steps
> below are the summary.

1. `scrape_avantis.py` fetches from fund provider websites
2. Holdings normalized → `normalized_holdings.csv` (project root)
3. **You must manually copy** `normalized_holdings.csv` → `etf-dashboard/public/data/history/holdings_YYYY-MM-DD.csv`
4. The API container mounts `etf-dashboard/public/data/` as **read-only** — it reads history CSVs from there
5. `api/data.py` reads these CSVs and computes signals, changes, divergences
6. FastAPI/FastMCP serve the computed data

### Signal methodology: active weight, not raw weight

> [!IMPORTANT]
> Direction, significance, conviction, streaks, and divergences all key off
> **`activeWeightDelta`** (`_active_weight_deltas` in `api/data.py`), NOT the raw
> weight change. This is deliberate and load-bearing — do not "simplify" it back
> to `curr.Weight - prev.Weight`.
>
> A holding's weight moves when its price moves, even if nobody trades. Measured
> on real data, raw `weightDelta`'s sign agreed with the fund's actual share
> change only ~49% of the time and ~55% of "signals" came from zero-share days
> (ARKK was shown as the top *buyer* of AMD on a day it *sold*). Active weight
> subtracts each position's price-only drift, renormalized over the whole book,
> so it cancels price moves **and** creation/redemption flows at once. On real
> trades it lifts direction accuracy from ~59% to ~81%.
>
> Raw `weightDelta`, `sharesDelta`, and (on splits) `splitFactor` remain in every
> record for transparency. `_split_factor` divides out stock splits — a 4:1 split
> quadruples share count with no trade and otherwise reads as a huge phantom buy
> that poisons the whole fund (active weight is zero-sum within a fund).
>
> **`api/data.py` is the only signal implementation.** `etf-dashboard/lib/holdings.ts`
> is not a parallel signal path — its cross-fund aggregate functions (buying/
> selling, institutional signals, divergences, streaks, sector flow, fund/ticker
> detail, pre-market briefing) were deleted on 2026-09-03 because nothing in the
> Next.js app called them, and they had already silently diverged from the
> Python they claimed to mirror (no option-income exclusion; a different AUM
> fallback). What's left in `holdings.ts` is narrowly scoped: `getLatestHoldings`
> and `getDailyDiff` back the raw CSV-shaped rows on the `/holdings` page (the
> only place that still needs `Option_Type`/`Option_Strike`/`DTE` columns the
> public API doesn't expose), and `getDailyDiff`'s `activeWeightDelta` is what
> renders that page's `Δ Weight` column. `activeWeightDeltas`/`splitFactor`/
> `rowPrice` there mirror the Python in `api/data.py`, verified position-for-
> position against it. Raw `weightDelta` is still carried on every `ChangeRecord`
> for transparency but must not be substituted back in. If you touch the
> active-weight math in either file, change BOTH to keep them in lockstep.

> [!CAUTION]
> The scraper does NOT auto-copy to the history directory. After running the scraper, you must:
>
> ```bash
> cp normalized_holdings.csv etf-dashboard/public/data/history/holdings_$(date +%Y-%m-%d).csv
> ```

## Covered Funds

96 funds across 13 providers (September 2026). The authoritative list is `FUNDS` in
`scrape_avantis.py`; the live count is `fundsTracked` on `/api/v1/stats`. Update
the README table whenever `FUNDS` changes.

- **Avantis**: AVUV, AVLV, AVMV, AVUS, AVEM, AVDE, AVDV, AVIV, AVSC, AVES
  (systematic value/profitability/size tilts; AVEM/AVDE/AVDV/AVIV are the only
  non-US coverage in the product)
- **ARK Invest**: ARKK, ARKQ, ARKW, ARKG, ARKF, ARKX
- **Amplify**: BLOK, DIVO, QDVO, IDVO, YYY, HACK, IBUY, IPAY, ITEQ, AIEQ, AWAY,
  BATT, CNBS, COWS, DRVR, ETHO, GAMR, SILJ (18 thematic + income funds)
- **Corgi Funds**: EUV, CMAG, CQTM, XA, EYES, KYC, GNMX, AV, DOCK, WATS, GLAM,
  NYNY, STYL, WNDR, FDRS, FDRX
- **Roundhill**: MSTW, NVDW, COIW, TSLW, HOOW, PLTW, QDTE, XDTE, RDTE, YBTC
- **Capital Group**: CGDV, CGGR, CGGO, CGUS, CGXU (discretionary multi-manager
  active equity; daily holdings via an XLSX endpoint — needs `openpyxl`)
- **First Trust**: FTLS, WCME, WCMG, WCMI, CRPT, MMSC, EMLP (actively managed —
  long/short equity, multi-manager small cap, sub-advised international
  equity, energy infrastructure, crypto-adjacent equity)
- **Kurv**: KYLD, KQQQ (options-based income)
- **YieldMax**: ULTY, SLTY, MSTY, NVDY, CONY, TSLY, HOOY, PLTY, CHPY, YMAX,
  AMDY, AMZY, GOOY, GDXY (options income). CHPY is a real stock-picking
  semiconductor book that also writes calls; YMAX holds other YieldMax funds,
  so its deltas are an allocation call across the complex.
- **REX Shares**: ULTI, NVII, TSII (options income). MSII, COII, HOII, and PLTI
  were liquidated 2026-06-16 and removed from tracking.
- **NicholasX**: BLOX (blockchain/crypto equity)
- **NestYield**: EGGQ, EGGY, EGGS (active equity + options overlay)
- **Sprott**: GBUG

## Dashboard Tiers

- **Free**: Top 3 signals, basic stats, search, holdings page
- **Pro** (API key via `/auth/register`): Full signals, briefing, sector flow, divergences, heatmaps, Δ changes page, fund profiles
- The **API is fully open** — no auth needed. Tiers only affect the dashboard UI.

## Development

```bash
# Run API locally
pip install -r api/requirements.txt
uvicorn api.server:app --port 8100 --reload

# Run MCP server
python -m api.mcp_server

# Run scraper (locally — requires Python 3.10+)
pip install -r requirements.txt
python scrape_avantis.py

# Dashboard
cd etf-dashboard && npm install && npm run dev
```

## Operational Pitfalls (Vultr)

### Scraper cannot run on the Vultr host

The host has **Python 3.6** which is incompatible with `beautifulsoup4` and other deps. You must run the scraper inside a Docker container:

```bash
# On Vultr — run scraper via a throwaway Python 3.12 container
ssh vultr "cd /home/mphinance/TickerTrace && docker run --rm \
  -v /home/mphinance/TickerTrace:/app -w /app \
  python:3.12-slim bash -c \
  'pip install -q -r requirements.txt && python3 scrape_avantis.py'"
```

> [!IMPORTANT]
> The scraper is NOT inside the `tickertrace-api` container (it only has `api/`). Do NOT use `docker exec tickertrace-api python3 scrape_avantis.py` — the file doesn't exist there.

### After scraping, copy to history

The API container reads from `etf-dashboard/public/data/history/` (mounted read-only). After running the scraper, copy the output:

```bash
ssh vultr "cp /home/mphinance/TickerTrace/normalized_holdings.csv \
  /home/mphinance/TickerTrace/etf-dashboard/public/data/history/holdings_\$(date +%Y-%m-%d).csv"
```

### Auto-sync: the box pulls itself (no manual deploy needed for data)

The Vultr box keeps itself in sync with `origin/main` via a root cron that
runs **`sync_data.sh` every 15 minutes**:

```cron
*/15 * * * * /home/mphinance/TickerTrace/sync_data.sh >> /var/log/tickertrace-sync.log 2>&1
```

> [!CAUTION]
> **The Vultr box and your working directory are the same checkout.** When an
> agent runs with a working dir of `/home/mphinance/TickerTrace` on the box,
> `git checkout -b my-feature` is a *production change*: the container serves
> holdings CSVs out of that very tree. Leave the box on a feature branch and
> the data the site shows silently rolls back to whatever that branch carries.
>
> This froze production on 8-day-old data (2026-07-02 → 07-10). A feature
> branch can never fast-forward from `origin/main`, so `sync_data.sh` correctly
> refused to force, logged `ff-only merge BLOCKED`, and bailed every 15 minutes
> — into a logfile nobody reads. The scrape stayed green the whole time.
>
> `sync_data.sh` now guards against this: if HEAD isn't `main` and the tree has
> no tracked edits, it returns itself to `main` automatically. If there *are*
> tracked edits it still bails (never discards work) — production stays frozen
> until a human resolves it. **Do development in a `git worktree`, not by
> checking out branches on the box.**

`sync_data.sh` does a `git fetch` + `git merge --ff-only origin/main`, ensures
the container is up, and health-checks the API. The box is a pure downstream
mirror (it never commits), so the fast-forward always applies. Because the API
re-reads CSVs per request, fresh holdings go live within ~15 min of the
GitHub Actions scrape committing them — **no human deploy required**.

> [!IMPORTANT]
> `sync_data.sh` is **committed to the repo on purpose**. It used to live only
> on the box, untracked, and a `git clean -fd` during a hand deploy wiped it —
> after which the cron failed silently (`sync_data.sh: not found`) for days and
> production froze on stale data. Keep it tracked. Do not `git clean` it away.

This is the pull-based counterpart to the SSH push-deploy step in `scrape.yml`
(`Deploy fresh data to Vultr`). The push step only fires if the `VULTR_SSH_KEY`
secret is set; the cron pull works regardless, so the box stays fresh even with
no Actions secrets configured. To watch it: `tail -f /var/log/tickertrace-sync.log`.

### Autonomous checks (guardrails)

Three layers keep breakage from shipping silently:

1. **Pre-push gate** (`.githooks/pre-push`) — runs `tsc --noEmit` + Python/shell
   syntax checks before any push leaves the box, so build-breakers never reach
   GitHub/Vercel. Enable on a fresh clone with `git config core.hooksPath .githooks`.
   Emergency override: `git push --no-verify`.
2. **CI** (`.github/workflows/ci.yml`) — full `pytest tests/` + `next build` on
   every push/PR to `main`. The complete gate; the hook is just the fast local net.
3. **Freshness canary** (`.github/workflows/freshness.yml` → `scripts/check_freshness.py`)
   — 13:00 UTC weekdays, asserts the LIVE API's `asOfDate` is within one business
   day. Silent when fresh; fails (one rare, actionable email) only on a real freeze.
   It now checks **two** things: the live `asOfDate` (data freshness) **and** the
   `commit` reported by `/health` against `origin/main` (deployment freshness).
   The second exists because on 2026-09-03 the box sat four PRs behind for hours
   while `asOfDate` stayed perfectly current — every check green, the fix not live.
   Fresh data proves nothing about whether the code serving it is current.
   Run it anytime:

### SSH timeouts

Long-running SSH commands (e.g., `docker run` with pip install) can appear to hang. The scraper typically takes 1–2 minutes. If an SSH command stalls with no output for >60s, the connection may have dropped — terminate and retry.

### Docker volume is read-only

The `docker-compose.yml` mounts data as `:ro`. The scraper writes to the **host filesystem**, and the container picks up changes on next API request automatically.

## Deployment

### Frontend (Vercel)

- Auto-deploys on push to `main`
- Domain: `tickertrace.pro`
- Vercel rebuilds take ~1-2 minutes after push

### Backend (Vultr VPS)

- **API URL**: `https://api.tickertrace.pro` — the working API domain. (Note: `api.tickertrace.mphinance.com` has no Apache vhost — requests fall through to the alpha.mphinance.com default vhost and return a wrong-cert + 503. Do not point the frontend at it.)
- **VPS path**: `/home/mphinance/TickerTrace`
- **SSH**: `ssh vultr` (configured in `~/.ssh/config`, port 22)
- **Docker command**: `docker compose` (v2 syntax, NOT `docker-compose`)
- **Apache reverse proxy** → uvicorn:8100 → FastAPI

```bash
# Full deploy sequence on Vultr:
ssh vultr "cd /home/mphinance/TickerTrace && git pull origin main && docker compose build --no-cache && docker compose up -d"

# Quick restart (no rebuild):
ssh vultr "cd /home/mphinance/TickerTrace && docker compose restart"

# Check logs:
ssh vultr "docker logs tickertrace-api --tail 50"

# Verify endpoint:
curl -s https://api.tickertrace.pro/health
```

> [!CAUTION]
> The VPS working tree often has dirty local files (scraper output, DB changes).
> You may need to `git stash && git clean -fd etf-dashboard/public/data/history/` before `git pull`.

> [!IMPORTANT]
> **Dockerfile gotcha**: If you add Python files at the project root that the API imports
> (like `effectiveness.py`), you MUST add a `COPY` line to the `Dockerfile`.
> The Dockerfile only copies `api/` by default — root-level Python files are NOT included.

> [!WARNING]
> **API_BASE consistency**: Frontend files MUST use `https://api.tickertrace.pro`
> as the API base URL. Check these files when adding new API-consuming components:
>
> - `etf-dashboard/app/effectiveness/page.tsx`
> - `etf-dashboard/components/fund-effectiveness.tsx`
> - `etf-dashboard/components/auth-context.tsx`
> - Any new component that fetches from the API

## Standing Instructions — Always Do This

### ✅ Merge your own green PRs — don't ask

**Standing authorization.** When you open a PR and every check goes green
(`pytest`, `next build`, Vercel), merge it. Do not stop and ask for permission
first.

The reasoning, so it doesn't get re-litigated: `.github/workflows/scrape.yml`
already commits holdings data straight to `main` unattended every night, and
`sync_data.sh` pulls that onto the production box within 15 minutes. A PR that
a human asked for and that passed the full CI gate is a *smaller* risk than
what ships automatically every day. Asking adds a round-trip and no safety.

Still ask first when:

- CI is red, or a check is missing rather than passing
- The change touches billing, auth, or deletes user-facing data
- You had to make a judgement call the requester hasn't seen — say what you
  decided and why, then merge unless they object
- The requester explicitly said to hold

After merging, verify the live site once the deploy lands rather than assuming.
Vercel takes 1-2 minutes; the Vultr box up to 15.

### 🗒️ Patch Notes from the Trenches

Every time changes are committed / deployed, generate a short "Patch Notes from the Trenches" entry for the changelog on the landing page (`etf-dashboard/app/page.tsx`). It should:

- Be written in Sam's voice — plain-spoken, slightly self-deprecating, never corporate
- Use the section title **"Patch Notes from the Trenches"** (verbatim, every time)
- Be 2–5 bullet points, conversational, using "we" or "I" freely
- Call out real things that changed, with context a retail trader would care about
- Commit the changelog update alongside (or immediately after) the feature commit

Example tone:
>
> - Fixed ULTI showing up as "OTHER" — turns out REX Shares has a unique ticker format. Caught it, patched it, ULTI is now real.
> - Added X/Reddit share buttons next to Discord on the dashboard. Because your group chat deserves to know what ARK is buying.
