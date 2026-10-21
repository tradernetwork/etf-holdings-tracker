# The TickerTrace Data Pipeline — Scrape → Normalize → ETL

> **This is the one place.** If you want to understand where TickerTrace's data
> comes from and how it gets cleaned, diffed, and served, read this file. It is
> the canonical reference; `README.md`, `CLAUDE.md`, and `AGENTS.md` point here
> for the details.

The whole pipeline is two root-level Python files:

| File | Role |
|------|------|
| `scrape_avantis.py` | Fetch → normalize → enrich → load. Despite the name, it scrapes **all** funds across every provider, not just Avantis. |
| `cusip_lookup.py` | Resolves CUSIP identifiers to tickers (local cache + OpenFIGI fallback) for sources that ship CUSIPs but no symbols. |

Everything below is inside `scrape_avantis.py` unless noted.

---

## Part 1 — The 30-second overview (for anyone)

Actively-managed ETFs publish their full holdings every day. Once a weekday,
GitHub Actions runs the scraper, which:

1. **Downloads** each fund's holdings from its provider (CSV endpoints, Avantis'
   JSON API, iShares, Roundhill, Corgi, Sprott — one fetcher per source shape).
2. **Normalizes** every provider's wildly different column names into one
   standard schema (`Name`, `Ticker`, `Weight`, `Share Quantity`, …).
3. **Resolves** missing tickers from CUSIPs, strips Bloomberg exchange suffixes,
   and recomputes each weight from market value so the numbers are consistent.
4. **Enriches** option holdings — parses strike/expiry/type, pulls the
   underlying's price, computes moneyness and days-to-expiry.
5. **Loads** everything into SQLite, **diffs** today against the previous day to
   produce a `DailyChanges` table, and prunes old rows.
6. **Writes** the merged result to `normalized_holdings.csv`, which the workflow
   copies into `etf-dashboard/public/data/history/holdings_YYYY-MM-DD.csv` — the
   files the live API reads at request time.

```
provider sites ─► scrape_avantis.py ─► normalized_holdings.csv ─► history/holdings_<date>.csv
                        │                                                    │
                        └─► data/holdings.db (SQLite: Holdings + DailyChanges)│
                                                                             ▼
                                              FastAPI / FastMCP read the CSVs per request
```

**Schedule:** `.github/workflows/scrape.yml`, cron `0 12 * * 1-5` (12:00 UTC,
Mon–Fri). The job runs the scraper, copies the output into history, keeps the
last 30 days, and commits to `main`. The Vultr box pulls `main` every 15 min
(`sync_data.sh`), so fresh data is live within ~15 minutes of the commit — no
manual deploy.

> **Note on signal math:** the pipeline described here produces *holdings*. The
> *signal* conviction/ranking is computed downstream in `api/data.py` off
> **active weight** (`_active_weight_deltas`), not raw weight delta, and the
> ADD/TRIM *badge* of a record follows the split-adjusted share count
> (`change_direction` → the `direction` field, which can legitimately disagree
> with the active sign). See the "Signal methodology" callout in `CLAUDE.md` —
> do not confuse the three.

---

## Part 2 — The code-level walkthrough (for contributors)

### Stage 0 — Config & constants

| Symbol | Line | What it is |
|--------|------|-----------|
| `FUNDS` | ~50 | List of every tracked fund: `{'ticker', 'type', ...}`. `type` selects the fetcher. |
| `COLUMN_MAPPING` | 141 | The heart of normalization — maps every provider's column spellings onto the standard schema. |
| `RAW_DIR` | 130 | `data/raw/<date>/` — per-fund raw CSV snapshots (audit trail). |
| `DB_PATH` | 132 | `data/holdings.db` — SQLite store. |
| `DASHBOARD_CSV` | 134 | `normalized_holdings.csv` at repo root — the merged daily output. |

`_http_get` / `_http_post` (lines 35, 45) wrap every network call with tenacity
retry (3 attempts, exponential backoff) on transient 5xx/connection errors. 4xx
does **not** retry — a 4xx means the URL is wrong.

### Stage 1 — Fetch (one function per source shape)

`main()` (line 786) loops `FUNDS` and dispatches on `fund['type']`:

| `type` | Fetcher | Line |
|--------|---------|------|
| `avantis` | `get_holdings_avantis` | 346 |
| `csv` (default) | `get_holdings_csv` | 384 |
| `roundhill` | `get_holdings_roundhill` | 423 |
| `ishares` | `get_holdings_ishares` | 479 |
| `corgi` | `get_holdings_corgi` | 504 |
| `sprott` | `get_holdings_sprott` | 556 |

Each returns a raw provider-shaped DataFrame (or `None` on failure). Failures are
collected in `failed_funds`, not raised — see the failure policy below.

### Stage 2 — Normalize (`main` loop body, lines 824–864)

Per fund, in order:

1. **`normalize_columns(df)`** (604) — `rename(columns=COLUMN_MAPPING)` and drop
   duplicate columns. This is what turns `weight` / `% of fund` / `Weighting` /
   `weight (%)` all into a single `Weight`.
2. **Force `ETF Ticker`** to the config ticker (826). Sources like REX put
   `REX_ULTI` in an `Account` column; we always overwrite with the real ticker.
3. **Ticker cleanup** (828–836): strip Bloomberg exchange suffixes
   (`RKLB UQ` → `RKLB`), then fall back to `CASH` or `OTHER` for blanks.
4. **CUSIP resolution** (838–852): any `OTHER` row that has a CUSIP is resolved
   via `cusip_resolver.resolve_batch()` (`cusip_lookup.py`, cache + OpenFIGI).
5. **Disclaimer / junk filter** (854–859): drop rows with a >30-char "ticker"
   (iShares stuffs disclaimers there) and rows with no `Name`.
6. **`clean_data(df)`** (611): strip `%`/`$`/`,` from numeric columns and coerce;
   **recompute `Weight` from `Market Value`** so weights are internally
   consistent; standardize `Date` to `YYYY-MM-DD`.

### Stage 3 — Enrich (`enrich_with_analytics`, line 287)

For option holdings, `parse_option` (190) extracts underlying / strike / expiry /
type from the contract name; `get_underlying_prices` (258) fetches spot prices
(yfinance) to compute `Moneyness` and `DTE`. Each fund's enriched frame is also
written to `data/raw/<date>/<ticker>_<date>.csv` (870) as an audit snapshot.

### Stage 4 — Load & diff (after the loop, lines 878–892)

All fund frames are `concat`'d into `final_df`, then:

1. **`save_to_db(final_df)`** (640) — maps `Share Quantity` → `Share_Quantity`
   etc., keeps only schema columns, de-dupes on `(Date, ETF_Ticker, Ticker)`, and
   `INSERT OR REPLACE`s into `Holdings` via a temp table. **Idempotent** — re-runs
   update in place instead of erroring.
2. **`generate_changes_sql(today)`** (686) — finds the most recent prior date and
   builds `DailyChanges` with a single parameterized SQL diff: current LEFT JOIN
   previous catches new/changed positions, previous LEFT JOIN current catches
   removals. Threshold: any share change, or weight change > 0.0001.
3. **`cleanup_old_records()`** (756) — retention sweep: `Holdings` kept 30 days,
   `DailyChanges` 365 days, then `VACUUM`.
4. **`final_df.to_csv(DASHBOARD_CSV)`** (891) — writes `normalized_holdings.csv`.

### Stage 5 — Publish (GitHub Actions, `scrape.yml`)

The scraper writes `normalized_holdings.csv`; the **workflow**, not the script,
copies it into the read paths and commits:

```bash
cp normalized_holdings.csv etf-dashboard/public/data/holdings_latest.csv
cp normalized_holdings.csv etf-dashboard/public/data/history/holdings_${TODAY}.csv
find etf-dashboard/public/data/history -name "holdings_*.csv" -mtime +30 -delete
```

> **The scraper does NOT auto-copy to history.** If you run it by hand, you must
> copy the output yourself (see the manual run below), or the API keeps serving
> the last committed history file.

### Failure policy (lines 894–909)

- **0 funds collected** → exit 1 (hard fail).
- **> 25% of funds failed** → exit 1 (abort to protect data integrity).
- **≤ 25% failed** → log a warning and commit the partial data.

---

## Running it yourself

```bash
# Local (Python 3.10+)
pip install -r requirements.txt
python scrape_avantis.py
# → writes normalized_holdings.csv at repo root; copy into history if testing the API:
cp normalized_holdings.csv etf-dashboard/public/data/history/holdings_$(date +%Y-%m-%d).csv
```

On the Vultr host, the system Python is 3.6 and can't run the deps — use a
throwaway Docker container (see `README.md` → "Manual scrape on Vultr").

## Adding a new fund

The pipeline is config-driven — you add a `FUNDS` entry and a couple of maps, you
don't write new scraping code (unless the source needs a brand-new fetcher shape).
Full checklist: **`.agents/workflows/add-fund.md`**.
