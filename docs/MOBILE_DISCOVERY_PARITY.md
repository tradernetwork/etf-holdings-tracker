# Mobile discovery parity: changes, stocks and institutional history

Implements GAPS.md group 4, using existing public endpoints. Fund-screen implementation is owned separately and is untouched here. Shared response shapes and fetchers live in `mobile/lib/discovery/`; the only common-client change exports the existing retry/cancellation-aware request function. No API endpoint/schema or native dependency changes.

## Field-by-field review checklist

| Website element | Native destination | Fields and controls retained |
|---|---|---|
| `/changes`: comparison window | Explore / Today → Changes | [x] daily / weekly / monthly; [x] snapshot date; [x] complete equity change feed, including minor/zero-active adjustments; [x] displayed record and add/reduce counts |
| `/changes`: filters and ordering | Changes → one filter sheet | [x] fund; [x] provider; [x] sector; [x] NEW / EXIT / ADD / TRIM; [x] buying/selling/both; [x] ticker/name/fund search; [x] removable active-filter chips/reset; [x] sort ticker/name/fund/type/absolute-active-Δ with direction; [x] provider grouping toggle |
| `/changes`: row fields | Changes fund rows / full ticker evidence | [x] fund + provider and fund link; [x] ticker + company name and ticker link; [x] sector or explicit unknown; [x] previous → current allocation; [x] drift-adjusted active Δ in pp; [x] estimated signed dollar flow; [x] NEW/EXIT identity; [x] stale disclosure labels; [x] null-is-unknown |
| `/changes`: by-ticker rollup | Changes → By ticker | [x] ticker/name/sector; [x] named buying/selling fund counts; [x] net active Δ; [x] estimated net dollar flow; [x] known-dollar-row count, so partial sums are explicit; [x] View all fund changes expands every row with entry/exit identity |
| Today Add/Cut | Today overview | [x] no calculation from capped `/signals.changes`; [x] shared complete daily source with Changes; [x] category filter from row `fundCategory`; [x] unknown denominator remains —; [x] irreducible cap is labelled |
| `/dashboard`: activity heatmap | Changes → Activity matrix | [x] `/activity` significance-filtered equity universe; [x] ticker × fund; [x] provider/fund labels and links; [x] NEW/EXIT/ADD/TRIM; [x] signed active Δ; [x] All/buy/sell; [x] provider filter; [x] day/week/month; [x] horizontal fund scroll with pinned ticker column; [x] cell opens full change; [x] **every** returned ticker, exceeding website's 30-row heatmap cap |
| `/stocks`: directory rows | Explore → Stocks | [x] rank/ticker/name/sector; [x] fund count; [x] total allocation sum; [x] net active daily change; [x] held-by fund links; [x] NEW entry funds; [x] EXIT funds; [x] signed streak; [x] distinct-family count/badge |
| `/stocks`: filters/sorts | Stocks → filter sheet + search | [x] widely held / most weight / biggest absolute Δ / longest absolute streak; [x] buying / selling / ≥3-day streak / new / exit / ≥2 families; [x] provider and sector with matching-count hints; [x] ticker/name search; [x] active chips/reset; [x] full returned ranked directory (up to 1,000 rather than website's 150), with API universe cap explicit |
| `/stocks/[ticker]`: institutional summary | Ticker → Institutional exposure | [x] `/stock/{t}` stock-picking universe; [x] signal label; [x] fund count; [x] AUM-blended allocation; [x] estimated exposure, correctly converting API millions to dollars; [x] day/week/month pp changes; [x] signed blended-weight streak |
| `/stocks/[ticker]`: history | Ticker → 30-session history | [x] all API sessions in sparkline; [x] first/last dates; [x] View all sessions includes each date, blended weight and holder count; [x] flat/one-point/empty series safe; [x] accessible chart description |
| Ticker evidence previously capped 3/side | Ticker → Opposite moves → View all | [x] actual destination `/evidence/{symbol}`; [x] every equity change, with direction toggle and significance count; [x] small adjustments accessible; [x] fund links/weight step/active Δ/dollar flow. Existing ticker holder list also gains reported shares |
| Institutional trend | Today preview → View all / Explore → Institutional trend | [x] Accumulating / Selling starting / Distributing / Bottoming groups from API; [x] ticker/name/sector; [x] blended allocation; [x] fund count; [x] day/week/month/all; [x] absolute selected-horizon sort; [x] ticker link; [x] every returned row (API top-50 rank limit explicitly noted) |
| Institutional summary | Trend → Combined institutional book | [x] day/week/month; [x] universe fund count + combined AUM ($B converted to dollars); [x] buying/selling; [x] ticker/name/sector; [x] previous → current blended allocation; [x] Δ and fund count/full-exit; [x] every named fund link; [x] server top-100-per-side bound explicit |

Pagination is native virtualization, not hiding data behind permanent excerpts. Summary cards are small; their View all links open real destinations. Ranking endpoints with hard server limits describe the returned universe instead of claiming the whole stock market.

## Completing `/changes` without an API addition

The actual 2026-10-09 live response hits the 5,000-row broad-query ceiling. Requesting `limit=5000` alone is not complete. On a capped response:

1. Read the existing `/funds` metadata once.
2. Query existing `/changes?provider=…` filters sequentially. Only providers that still cap are split into `/changes?fund=…` requests. Unknown-provider (`Other`) funds go directly by fund; visible funds absent from latest metadata are also queried explicitly.
3. Union by fund/ticker/type, preserve signed deltas and dollar fields, and reject results if snapshot dates differ. A single fund still reaching 5,000 rows remains explicitly `truncated`.

The live phone view showed **10,125 equity rows**, vs the initial 5,000, with **3,228 positive / 3,251 negative active changes** (zero-active rows remain inspectable). Today uses that same daily query/cache, applying category locally instead of independently splitting another request set. Five-minute React Query caching and abort signals reduce repeat work. Splitting is sequential to avoid a request burst; cold complete loads do cost more API requests/time, and fast switches of multiple uncached windows can encounter the existing 60/minute limiter. The existing client retries transient errors. A future paginated, snapshot-cached changes endpoint would reduce this cost; this PR does not depend on one.

No new financial scoring is introduced. Changes browse all rows as the website changes table does; activity consumes the API's significant buckets; the existing ticker preview's significance rules stay unchanged. Institutional classifications and blended-weight history are server-authored. Unknown sectors stay unknown, short dollar signs stay signed, stale books are labelled, and catch-up deltas are never coerced into zero or surfaced as fresh daily trades. The history chart shows disclosed allocations, not a synthetic trade tape.

## Validation and visual evidence

- Live API fixture provenance: `https://api.tickertrace.pro/api/v1/{changes?limit=5000,activity,tickers?limit=1000,stock/TSLA,institutional-trend?limit=50,funds}`, fetched 2026-10-11, snapshot 2026-10-09. Fixture arrays for broad endpoints retain bounded real samples; the stock history preserves all 30 sessions. Edge cases are deliberate transformations of those actual rows, not mocked formulas.
- Jest: full suite **202 passed / 10 suites**. New behavioral coverage: combined filters, active-vs-raw direction, NEW/EXIT identity, null/option exclusions, counts beyond top 50 with category/snapshot identity, stock filters/sorts, trend horizon ordering/nulls, complete matrix cells, all-session/flat history, opposing-fund ticker rollups and unknown-dollar totals, capped provider/fund splitting, irreducible cap disclosure, unknown-provider splitting, and mid-load snapshot change rejection.
- `npm run typecheck`: clean.
- `npm run export:web-preview`: successful; export `/tmp/tt-discovery-web`, base `/previews/app`.
- Python Playwright at **390 × 844**, real live API responses cached at the network boundary to make repeat captures deterministic. Browser interaction checks passed for change search/chip reset/ticker rollup expansion, stock search/all-holder expansion, matrix cell details, horizon selection, full history sessions and ticker evidence navigation; no page errors. This is a React Native Web preview, not an installed Android acceptance test.

Screenshots (all new destinations plus integration points): [Changes](mobile-discovery-screens/changes.png), [Change filters](mobile-discovery-screens/changes-filters.png), [Stocks](mobile-discovery-screens/stocks.png), [Stock filters](mobile-discovery-screens/stocks-filters.png), [Activity matrix](mobile-discovery-screens/activity.png), [Trend](mobile-discovery-screens/trend.png), [Combined book](mobile-discovery-screens/institutional.png), [Full ticker evidence](mobile-discovery-screens/evidence-TSLA.png), [Ticker history](mobile-discovery-screens/ticker-TSLA.png), [Explore navigation](mobile-discovery-screens/explore.png), [Today](mobile-discovery-screens/today.png).

## Remaining work owned by other parity groups

This is discovery group 4, not all six groups: income books/sleeves/option-holder rows and option trade timelines; raw holdings browser/export; effectiveness/rotation; complete briefing/divergence/sector/layering detail and integrations remain separate. The existing top-level Today signal/sector/consensus excerpts are unchanged except the changes destination and trend preview. Fund positions and fund detail are not touched. No native package, release signing, backend or deployment changes.
