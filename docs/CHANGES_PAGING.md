# Complete changes paging

`GET /api/v1/changes` preserves the legacy response (`asOfDate`, `count`, `changes`), default `limit=50`, maximum legacy `limit=5000`, and legacy tie ordering when neither `page` nor `size` is supplied.

Opt into paging:

```text
/api/v1/changes?period=daily&page=1&size=2000
/api/v1/changes?period=daily&page=2&size=2000&snapshot=<page-1-token>
```

Paged JSON adds `total` (filtered row count), `page` (1-based), `size` (max/default 2000), `pages` (0 for empty results), and `snapshot` (opaque token). `count` still means returned rows. Supplying either page or size opts in; paging overrides legacy limit. Out-of-range pages are empty. Ordering is absolute active Δ descending, then fund, ticker, raw type; null deltas sink. Existing significance, option exclusion, stale and catch-up rules are untouched: this is the full guarded equity change list, including minor changes.

Filters run before paging/export: `period=daily|weekly|monthly`, `category=active-equity|option-income`, `provider`, `fund`, `direction=buying|selling`, plus additive `sector` (exact), `q` (case-insensitive ticker/name/fund search), and `type=NEW|REMOVED|CHANGED`. As before, an explicit fund takes precedence over provider; direction uses signed **active** delta, not raw type/price drift. Clients may apply their existing ADD/TRIM display rules.

`format=csv` exports every filtered row, ignoring limit/page/size. Headers include all row fields, unknown dollar values stay blank, and option rows remain outside this endpoint's equity universe.

## Snapshot and memo correctness

The full guarded list is memoized by period and `_memoize_per_snapshot` signature, before request filters. Daily covers latest + previous files. Weekly/monthly calculate the depth through the actual ~7/~30-calendar-day comparison file, including the oldest-file fallback in sparse history; never assume a fixed 12-file window. Latest also supplies AUM; provider/category/sector fallback tables are deployed constants. Directory additions/removals and same-day rewrites invalidate. No JSON snapshots, wall clock or network enter this function.

The computation checks its signature before/after and retries on a concurrent sync; repeated transitions return 503. Later pages pass page 1's token. 409 means any contributing snapshot changed (even if `asOfDate` did not); restart the load. This prevents silently combining books. Daily is added to the existing daemon prewarmer; it checks stop before that extra unit. Existing endpoints do not gain new background loops.

The memo retains the existing helper's bounded 16 entries, stampede lock and deep-copy isolation. Copying a large complete list has a visible per-page cost; this is a compute-saving cache, not a zero-copy cache.

## App negotiation

One request contains `page=1&size=2000&limit=5000`. Updated servers identify support with the paging response fields; no extra capability call is needed. Remaining pages load in batches of up to three, with the token. The app verifies the date/token, consistent total/size/pages, expected page and row count, complete union and unique fund/ticker/type identities before publishing data. Errors leave the previous complete query result intact; they never masquerade as an uncapped partial feed.

Old servers ignore page/size, so the same initial response doubles as the legacy request. No metadata call for an uncapped legacy result; capped results use the retained sequential provider/fund splitter. Irreducible single-fund caps remain labelled, and mixed as-of dates remain rejected. No native package changes.

## Validation

Tests cover legacy byte compatibility, >5,000-row complete unions with stable ties, composing filters, uncapped CSV/blank dollars, new snapshots and rewrites, deep/sparse lookbacks, stale/catch-up exclusions, schema metadata, bounded mobile concurrency, inconsistent/duplicate page rejection and old-server fallbacks. Real-history performance and request counts are recorded in the PR; timing uses FastAPI TestClient (in-process HTTP, not VPS/network latency).

Verified after rebase onto 7b245ba: **435 pytest tests**, **240 Jest tests / 12 suites**, TypeScript, and Expo web export passed. A Playwright phone preview against the actual local new API displayed all **10,125** daily rows with exactly **six** page requests, no provider/fund changes requests and no page errors.

On the committed 163-CSV history (153 market-day files), Oct 9 daily cold completion went **25 → 6 requests** (including the legacy metadata call). Page unions matched the full daily/weekly/monthly books: **10,125 / 11,270 / 12,895** rows. All nine legacy period/category JSON responses were byte-identical. Warm TestClient HTTP, min of five isolated calls: **173.59 ms** for a 2,000-row page, **98.74 ms** for the legacy 50-row response (baseline ~285 ms). The full memo's deep copy alone measured ~97 ms in the initial run; network/VPS timing will differ.
