# Stock detail: share the work, keep the data

`/api/v1/stock/{ticker}` previously scanned about 30 sessions separately for
EVERY ticker. On the committed 163-file history, NVDA made 541,864 AUM lookups
and 1,625,640 filesystem-stat calls. The five-file CSV cache also reparsed
33 files. Two busy workers could spend most of their time on this one endpoint.

## Implementation

- `_ticker_snapshot_index` indexes latest holders, option legs and the guarded
  daily change list for all ticker/underlying keys once. `/ticker/{ticker}` and
  `/stock/{ticker}` copy just their requested ticker's payload.
- `_stock_history_index(history_days=30)` aggregates all institutional tickers
  in one pass through each required snapshot. Retained series use compact
  `(date, weight, fundCount)` tuples; only the requested series becomes JSON
  dictionaries. Neither index retains the historical CSV rows.
- Both indexes use the existing bounded, stampede-locked snapshot memo.
  History signatures cover at least 30 sessions AND the actual calendar-month
  baseline, including sparse-history fallbacks. Rewritten older history files
  invalidate the index. The prewarmer watches this same wider signature and
  warms both indexes, with cancellation checks between units.
- `aum_snapshot_scope` pins the lazily resolved AUM map for one HTTP request or
  memo computation. Nested scopes reuse it; ContextVars isolate concurrent
  requests and propagate to FastAPI's handler thread. Every new scope checks
  the latest snapshot's date/path/mtime/size again. No TTL can leave a same-day
  correction stale. Standalone institutional blending has the same scope.

## Catch-up semantics

Each adjacent history step and each day/week/month comparison uses
`catch_up_funds_between` on whole-fund metadata, including option rows.
Caught funds' contributions are removed from BOTH endpoints of that comparison;
the latest AUM denominator stays fixed, preserving healthy funds' contributions.
Partial carry-forward is fresh; False-to-missing is guarded; old files without
Refreshed and newly tracked funds remain unaffected, exactly as in the shared
change engine.

The latest blended weight and dollar exposure remain actual current exposure.
For a catch-up jump, historical chart levels are stitched backward from that
latest exposure using guarded daily changes. This removes the false one-session
jump rather than inventing a daily trade. Such a series additionally returns
`historyAdjustedForCatchUp: true`; its prior weight levels are adjusted chart
levels, not literal earlier reported allocations. Ownership counts retain the
actual historical observations. Ordinary series have no added flag and preserve
the previous JSON byte for byte, including signed zero, rounding, key order and
trend labels calculated from UNROUNDED horizon deltas.

Monthly comparisons beginning before a stale gap retain legitimate multi-week
changes. A window whose baseline is carried-forward excludes the caught fund.

## Verification (local, October 11, 2026)

Real history: 163 CSV files / 153 market sessions, main `03da40c`.

| Measurement | Before | After |
|---|---:|---:|
| NVDA in-process warm, minimum of five | 10.228 s | 1.26 ms |
| Cold all-ticker build, unprofiled | per ticker ~10 s | ~7.8–10.7 s once/snapshot |
| Warm `/stock/NVDA`, TestClient minimum of five | — | 9.0 ms |
| Warm `/ticker/NVDA`, TestClient minimum of five | — | 8.5 ms |
| `/options/NVDA`, TestClient minimum of five | separate path | 119.7 ms |

NVDA, TSLA, AAPL, MSTR and EUR JSON is byte-identical to main on the ordinary
history. Independent Monday simulation hard-linked history into a temporary
directory and added Saturday's `holdings_2026-10-10.csv` as the market-day
`holdings_2026-10-12.csv`: TER daily -0.0078pp becomes 0.0000pp, the chart's
phantom step disappears, and monthly stays -0.0082pp. EUR remains byte-identical.
Synthetic regressions first failed on main and now pass; tests also cover deep
history corrections, shared work across tickers, owned return values, new-day
invalidation, unknown AUM, unrounded trend signs and repeated AUM lookups.

Two independent spawned worker processes, warmed with the existing prewarm
units before adding stock indexes, added **75.7 MiB** each RSS
(279.8 → 355.5 MiB). Extra warm work took 7.4 / 8.1 seconds
under simultaneous load. These are per-worker increases, about 151 MiB combined.
A fresh process's entire ~304 MiB RSS increase includes CSV parsing and existing
caches; it is not the incremental index footprint.

`/options/{ticker}` does not walk a 30-session blended history: it lazily reads
recent snapshots needed for option funds. It remains unchanged in this fix.
A fresh catch-up option fund's option trade comparison needs a separate guard
review; ARK's Monday catch-up is equity-only. The shared stock/ticker daily change
lists already use the guarded change engine.
