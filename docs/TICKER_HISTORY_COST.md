# Ticker active-flow history: measured cost and proposed next step

A requested `/api/v1/ticker/{ticker}/history?days=30` endpoint was prototyped,
benchmarked on the checked-in October 9, 2026 snapshots, and deliberately
**not shipped** in this change. `get_stock_detail` already supplies a blended
weight history for existing stock views; that is a different series from
aggregate daily active-weight flow and should not be relabeled.

## Evidence

The prototype reused `api/data.py`'s `_changes_between` / `_active_weight_deltas`
with equity rows and built one all-ticker aggregate table per consecutive CSV
pair. A 32-entry LRU shared those tables across ticker requests; file path,
mtime-nanoseconds and size invalidated a corrected CSV. The dollar enrichment
was skipped for this history-only calculation. A 30-calendar-day lookback
produced 21 daily comparisons on the current data.

- Cold process: **11.82 seconds**, **254.1 MiB peak RSS** (whole process, not
  incremental cache size), using `time.perf_counter` and `resource.getrusage`.
- A second, different ticker against warm tables: **0.34 milliseconds**.
- Under concurrent test/profiling load, cold measurements were 13.42–14.68s.
- Existing `_read_csv_cached` holds only **five** snapshots. A 30-day scan
  cannot depend on these already being cached. Increasing that cache would
  retain full vendor-row dictionaries for every file and consume more memory.
- The production API uses **two uvicorn workers**. Each would pay its own cold
  start after deployment/eviction; this is not a shared cache.

The warm lookup is cheap; the first request is not. An on-demand cold GET would
make the phone wait ~12 seconds and occupy API capacity on the current box.
No runtime endpoint or in-memory history cache is added by this PR.

## Proposed durable implementation

Compute aggregates once after a successful `sync_data.sh` update, inside the
Docker container (not host Python). Persist a small SQLite table or atomic
JSON artifact under the existing writable `api/data` volume, separate from
read-only holdings CSVs. Both API workers then read the same precomputed data.
On normal days calculate **one new snapshot pair**, not the entire month; use
input file hashes to rebuild only corrected pairs. Generate an initial backfill
as an explicit job before exposing the endpoint. Track artifact dates/hashes
and return an unavailable/pending response rather than silently serving stale
history when generation fails. Keep aggregate files outside git.

Contract: ascending points with `date`, `compareDate`, `activeWeightDelta`
(unweighted sum of equity active-weight changes across funds, **percentage
points**, not dollar flows/returns/ownership), and contributing `fundCount`.
Offer `category=active-equity|option-income`, default all funds, and bound
`days` to 1–30 calendar days ending at the latest trading snapshot. Missing
snapshots remain gaps; don't fabricate zeros on calendar dates with no file.
Handle carried/stale/missing fund books before aggregating and preserve the
source-date span. This still needs tests for splits, drift-only days, stale
books, category separation, corrections, process sharing and atomic publication.
