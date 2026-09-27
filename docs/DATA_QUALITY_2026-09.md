# Data-quality findings: stale funds, dropped funds, FLEX legs, option API surface

Investigation date: 2026-09-27. Scope: the 153 history files
(`etf-dashboard/public/data/history/holdings_2026-02-25.csv` → `…2026-09-25.csv`),
`scrape_avantis.py`, the GitHub Actions scrape logs still within retention, and
`/api/v1/holdings` / `/api/v1/funds`. Requested by TraderMatrix (downstream consumer).

## TL;DR

| # | Question | Finding |
|---|---|---|
| 1 | Why are EGGQ/EGGY/EGGS stuck on 2026-08-14? | NestYield **moved its holdings files**. The URL we scrape still returns HTTP 200 but the file is frozen at `08/14/2026`. The live file is now a dated, versioned WordPress upload linked from each fund page (`/wp-content/uploads/2026/09/TidalFG_Holdings_EGGQ-10.csv`, dated 09/25). Nothing errors, so nothing was logged. |
| 2 | Why did all YieldMax funds vanish on 9/23? | Every YieldMax fetch returned **HTTP 200 with a non-CSV body** (pandas: `Expected 1 fields in line 5, saw 2`, meaning the first line had no commas, so it was not the 12-column header; almost certainly an HTML/challenge page). The scraper logs the failure, **drops the fund**, and commits anyway because 14/98 failures is under its 25% abort threshold. |
| 2b | How often? | **24 of 153 files** silently dropped at least one fund that exists before and after that day. YieldMax went as a block on **18 weekdays**; REX (ULTI/NVII/TSII) for 5 straight days (403 Forbidden); NestYield on 5/27 and 8/13 (403 Forbidden). |
| 3 | FLEX legs | **52 of 615 option rows (8.5%)** on 9/25 are FLEX, not ~5%. The reliable signal is the OCC root's leading digit (`2AMAT 261218C00440000`). Every off-grid strike (x.01) has one, and 19 more FLEX legs (KQQQ, KYLD) have ordinary-looking strikes. |
| 4 | Option fields in `/api/v1/holdings` | Returns `fund, ticker, name, sector, weight, shares, weightDelta, sharesDelta, isOption, cusip`. **`shares` is already the signed contract count on option rows** (negative = written), but underlying, type, strike, expiry, market value, FLEX and file date are absent. They are exposed per fund at `/api/v1/fund/{fund}` → `optionHoldings`. |
| 5 | Freshness in `/api/v1/funds` | Not present. The only freshness signal is the global `asOfDate`, which is the newest file date, so a fund frozen since 8/14 reads as current. |

## 1. NestYield (EGGQ, EGGY, EGGS) frozen since 2026-08-14

- `FUNDS` points at `https://nestyield.com/wp-content/uploads/data/TidalFG_Holdings_{T}.csv`.
- On **2026-08-13** that URL returned `403 Forbidden` (log excerpt:
  `Error processing CSV for EGGQ: 403 Client Error: Forbidden for url: …TidalFG_Holdings_EGGQ.csv`).
  The next day it answered again, but its content has not changed since:

  ```
  $ curl …/uploads/data/TidalFG_Holdings_EGGQ.csv | head -2
  Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,…
  08/14/2026,EGGQ,STX,G7997R103,Seagate Technology Holdings PLC,10874,…
  ```
- Each fund page (`https://nestyield.com/eggq/`) now links a dated upload that *is*
  current:

  ```
  https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGQ-10.csv   → 09/25/2026
  https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGY-9.csv
  https://nestyield.com/wp-content/uploads/2026/09/TidalFG_Holdings_EGGS-10.csv
  ```
  The `-N` suffix and `YYYY/MM` folder change as they re-upload, so the URL has
  to be discovered from the fund page on each run rather than hardcoded.
- Why nobody noticed: the scraper stamps `Date` from the file (08/14), but the
  history file name and the API `asOfDate` come from the run date. Nothing compares
  the two. The effectiveness engine was grading these expired legs until #121
  (it now walks back and flags `dataStale`), but `/stocks/{ticker}`, `/api/v1/holdings`
  and the CSVs still present them as today's positions.

## 2. Dropped funds

Mechanism (`scrape_avantis.py`, `main()` and `get_holdings_csv()`):

1. `get_holdings_csv` catches every exception, logs `Error processing CSV for X`,
   and returns `None`. HTTP retries (tenacity) cover only network errors and 5xx.
   A 200 with the wrong body, or a 403, is never retried.
2. `main()` appends the fund to `failed_funds`. It writes nothing for it, so the
   fund is simply absent from `normalized_holdings.csv` and that day's history file.
3. If failures are ≤ 25% of `FUNDS` the run commits with a `WARNING` log line
   and exits 0. The Actions job is green.

Logs still within retention:

| Run date | Failed funds | Error |
|---|---|---|
| 2026-09-23 | ULTY SLTY CHPY YMAX AMDY AMZY GOOY GDXY MSTY NVDY CONY TSLY HOOY PLTY (14) | `Error tokenizing data. C error: Expected 1 fields in line 5, saw 2` (all 14) |
| 2026-08-13 | EGGQ EGGY EGGS | `403 Client Error: Forbidden` |
| 2026-08-13 | ULTY SLTY MSTY NVDY CONY TSLY HOOY PLTY | `Expected 1 fields in line 5, saw 2` |
| 2026-07-22 | ULTI NVII TSII | `403 Client Error: Forbidden for url: https://www.rexshares.com/ulti/` |

Historical count: a fund counts as dropped on a day when it appears in files both
before and after that day but not in that day's file. Funds that were added later
(First Trust on 9/12, DRAM/CHAT on 9/24 …) are excluded.

| Day | Dropped | Funds |
|---|---|---|
| 2026-04-14 → 04-22 (7 weekdays) | 8/day | CONY HOOY MSTY NVDY PLTY SLTY TSLY ULTY |
| 2026-04-28 | 1 | AVLV |
| 2026-05-13 → 05-15 | 8/day | YieldMax (same 8) |
| 2026-05-27 | 11 | YieldMax 8 + EGGQ EGGS EGGY |
| 2026-06-09, 06-18, 06-25, 06-29, 07-17 | 8/day | YieldMax (same 8) |
| 2026-07-22 → 07-28 | 3/day | NVII TSII ULTI |
| 2026-08-13 | 11 | YieldMax 8 + EGGQ EGGS EGGY |
| 2026-09-23 | 14 | all 14 YieldMax (13 listed downstream + YMAX) |

**Total: 24 of 153 files (15.7%)**, all weekdays. Most-dropped funds: ULTY, SLTY,
CONY, HOOY, MSTY, NVDY, PLTY, TSLY (18 days each). The frozen-NestYield
problem (§1) is separate and not counted here: those rows were present, just stale.

## 3. FLEX legs

On 2026-09-25, 615 option rows:

| Test | Rows |
|---|---|
| Strike off the $0.25 listing grid (490.01, 95.01, 678.8 …) | 33 |
| OCC root starts with a digit (`2AMAT`, `2MRVL`, `2MSTR` …) | 52 |
| Off-grid **and** digit root | 33 (every off-grid strike is also digit-rooted) |

So `is_flex` should be defined as: the OCC root has a leading digit, or the strike is off
the $0.25 grid. On current data the second test adds nothing, but it keeps rows flagged
if an issuer ever drops the prefix. `Option_Strike` is already stored exactly as
published (`95.01`, not rounded) and will stay that way.

## 4. Option fields in `/api/v1/holdings`

Today, per row: `fund, ticker, name, sector, weight, shares, weightDelta, sharesDelta,
isOption, cusip`.

- `shares` on an option row **is** the signed contract count (negative = written).
  It is already there; it may not have been obvious.
- Missing: underlying, type, strike, expiry, FLEX, market value, file date.
- `Option_Type` casing in the CSVs is `Call` / `Put` (title case), consistently
  across all 615 rows.

## 5. Per-fund freshness

`/api/v1/funds` and the CSVs have no per-fund date other than the raw `Date`
column. In `holdings_2026-09-25.csv`, 95 funds carry a September date and 3
(EGGQ/EGGY/EGGS) carry `2026-08-14`.

## Fixes (shipped; all additive: no column or field renamed or removed)

1. **NestYield**: discover the current `TidalFG_Holdings_{T}*.csv` link from the fund
   page each run, falling back to the old URL. Test with a fixture page.
2. **Dropped funds**:
   - Validate that a CSV response actually is a CSV (header present), and retry
     non-CSV 200s and 403s with backoff before giving up.
   - If a fund still fails, **carry forward its last good rows** with the new CSV
     columns `Refreshed=False` and `Source_Date=<date of the carried rows>`, instead
     of omitting it. Fresh rows get `Refreshed=True` and `Source_Date=<file Date>`.
   - The run summary lists carried funds explicitly.
3. **FLEX**: add an `Is_Flex` CSV column and `isFlex` in the API.
4. **`/api/v1/holdings`**: for option rows, add `underlying`, `optionType`
   (`CALL`/`PUT`, uppercase), `strike`, `expiry`, `isFlex`, `marketValue`, and on every
   row `fileDate`, `refreshed` and `stale`. `shares` keeps its meaning (signed contracts).
5. **`/api/v1/funds`**: add `lastHoldingsDate` (the fund's own file date) and `stale`
   (`lastHoldingsDate` older than the previous trading day).
6. **Stale option legs in the UI**: `/stocks/{ticker}` and the fund pages stop
   presenting expired legs from a stale fund as current.
7. (Optional, after 1–6) `/api/v1/options/{underlying}`: day-over-day structure pairing.

### Verification

- NestYield discovery, run live on 2026-09-27: EGGQ, EGGY and EGGS resolve to the
  `uploads/2026/09/…` files and return `09/25/2026` holdings (41 / 40 / 35 rows).
- FLEX: 52 of 615 option rows flagged on 2026-09-25, matching the research above.
- Structure pairing over all 136 underlyings with options on 2026-09-25 (vs. each
  fund's previous snapshot): 239 traded legs, **202 paired (84.5%)**. Kinds: 48 rolls,
  44 spreads, 4 synthetics, 3 collars, 2 other equal-size pairs, 37 unpaired. This is
  consistent with downstream's 85–89% measurement.
- Tests: `tests/test_scraper_quality.py` (discovery, CSV detection, carry-forward
  including an end-to-end `main()` run with retry passes, FLEX),
  `tests/test_data_quality_api.py` (API fields, staleness, expired-leg removal),
  `tests/test_structures.py` (pairing rules plus an end-to-end two-snapshot run).

### Not done / known limits

- The YieldMax non-CSV body was never captured, because the scraper didn't save it.
  The retry passes should absorb a transient block. If a fund still fails, the
  log now records the content-type and first line, so the next occurrence will
  say what the page was.
- `stale` uses weekdays only; the day after an exchange holiday errs toward "fresh".
- Carried-forward rows are excluded from SQLite and from day-over-day structure
  trades (they carry no new information), but they still appear in the CSV and
  in `/api/v1/holdings`, flagged, as requested.
