# Holdings visibility: the TWA looked like a changes app

Compared `8512ce1^` with `6af609d`, then this fix. Source inspection covered
all requested routes and the reusable components they render. Phone screenshots
use 390×844, live API data; native exports also checked at 1366×768.

The user's `1.0.0.0` version identifies the older Chrome TWA, which opens
`/dashboard?source=twa`. Its UI is the website, not the Expo internal-track APK.
Main's native app opens the fund's Positions tab correctly on phone and wide
windows. Its runtime is pinned by appVersion (currently 1.0.1); older 0.1.0
preview APKs cannot receive these newer-runtime updates.

No actual holdings values were found inside a blurred/locked flow tile. Web
flow-check/stock-flow tiles contain literal placeholder strings; native
FlowBridge contains decorative bars. This audit keeps those and all TM links.
The main regressions were new promotional panels BEFORE data and one explicitly
hidden stocks-directory column. Older phone-column hiding and top-20 excerpts
made the TWA problem worse; those are fixed too, without attributing them to Art.

| Route / element | Before Art | After Art | Restored / verified |
|---|---|---|---|
| `/dashboard`: institutional summary, trends, fund links, signals, sectors, activity | Visible | New FlowCheckCard before data; fixed promo strip covers viewport space | FlowCheckCard and live-flow KPI link after data; strip inline after page content; explicit holdings/fund-position links near search |
| `/fund/[ticker]`: active-equity portfolio | Top-20 excerpt after changes; shares hidden below lg, Δshares below xl | Same limitations plus bridge before streaks/holdings | Full guarded `/holdings?fund=…` book LEADS; shares, Δshares, market value, weight, active Δ; CSV + browser links; all rows, no top-N |
| `/fund/[ticker]`: income positions | Brokerage positions; Qty/Δ/NAV hidden on phones | Same, not removed by Art | Qty/Δ/NAV/price/coverage/strike-room/DTE remain columns accessible by horizontal scroll; positions still lead |
| `/fund/[ticker]`: option legs/contracts, cash/T-bills, activity, effectiveness | Present; stock-leg expansion and older-history disclosure | Unchanged | Preserved, including synthetic/real-share notes, signed contract quantities and all option-only positions |
| `/stocks/[ticker]`: holders / shares / weights / exposure | Shares hidden below md | Added locked TM panel BEFORE holders; data not blurred | TM panel after holders/options; Shares visible on phones, including zero/short positions |
| `/stocks`: aggregate total weight | Visible at phone width | Total wt explicitly hidden below sm; added flow column | Total wt restored on phones; flow links kept; filters/sorts/badges unchanged |
| `/holdings`: full raw book, quantities, Δshares, values, weights, option columns, CSV | Full filter/sort/page/export; quantities/values hidden below md, Δshares below lg | Same; compact bridge AFTER table already correct | All raw columns visible, including shares/Δshares/value/strike/expiry/DTE; scroll instead of hide; unknown value no longer becomes $0; full CSV retained |
| `/changes`: fund rows and quantity transitions | API mapping discarded previous/currentShares; legacy 5,000 cap | Same; added flow link column | Previous→current shares/contracts visible; complete snapshot-pinned pagination replaces cap; flow column retained |
| `/income`: activity and fund directory | Visible | GEX bridge before activity/directory | Bridge after data; activity, archetypes, directory fields unchanged |
| `/income/[fund]`: positions/book/metrics | Visible | Bridge already after book | Shares, coverage and long-leg columns also accessible at phone width; bridge remains after data |
| `/funds`: directory and metadata | Visible | Bridge before directory | Bridge after directory; all original rows/metadata retained |
| `/watchlist` | Route did not exist | Added watchlist; fund-buy/sell data visible, TM flow label is “Check live” | Preserved; no real ETF data blurred |
| `/`: live data widget / free-data access | Marketing landing, free dashboard link | Adds real top-buy widget + TM funnel; ETF allocation cell hidden on phones | ETF allocation cell visible on phones; TM placeholder-only lock remains; free-data link retained |
| Phone navigation / Holdings | Holdings tab existed | Holdings tab still exists; new fixed flow strip | Holdings retained; strip moved AFTER data so it cannot overlay positions |
| Native fund Positions | Full book; stock list starts with 20 + Show all; shares/value/weight, option counts already present | Layout width adaptation only; Positions still default | Stock list defaults to full virtualized book; shares/change labels prominent; unchanged option legs/cash/T-bills |
| Native ticker | Shares per fund already present; five holders + View all; small estimated values suppressed | Adds FlowBridge before history/holders | FlowBridge after ALL data; all holders default visible; small known estimated positions no longer suppressed |
| Native Holdings browser | Shares, Δshares, values, weights, full CSV already visible | Unchanged | Confirmed retained |
| Native Changes / fund changes | Quantity transition often in expanded detail; fund row only Δshares | Unchanged | Previous→current quantities visible without opening details, retaining provider, weight and $flow |
| Native Today | Signals/stats/sections plus referral footer | Only referral URL changed | Data unchanged; referral stays below data |

## Scope / honesty

- Ticker institutional blended flow and share-count changes are OUR data. They
  remain visible. TM-only live options tape placeholders are the only locked data.
- No API gates, user accounts or new dependencies added. All native changes are JS.
- Full fund book accepts only rows belonging to the requested fund. An unavailable
  or older unfiltered server falls back to an explicitly labelled Top Holdings
  excerpt plus a full-browser link, not a purported complete mixed-fund book.
- Complete changes pages are bounded to three parallel requests and pinned to one
  snapshot token; a scrape mid-load yields an honest reload notice, never mixed days.
- Unknown/null, stale and catch-up changes stay —. Real zero and negative quantities remain
  actual numbers. Estimated dollars are marked; raw market values remain distinguishable.
- Existing expandable strategy legs and ten-day/older-activity controls are preserved;
  Art did not introduce them. They expose every leg and count without a paywall.

## Evidence and checks

Committed screenshots: [before/after gallery](audits/holdings-visibility/README.md).
Readable page text and wide evidence: `/tmp/tt-visible-shots/`, before/after for
website and native MSTY, ARKK, AVUV, TSLA; native wide-window evidence included.
Native local web requests used a test-only CORS proxy to the LIVE API; no product
CORS changes or mock financial values. Main native Positions tab, full holdings,
share counts and values were confirmed before changes, ruling out the reported
native regression. Website screenshots reproduce the missing phone share columns
and the promo overlay; after screenshots verify the restoration.


Final verification: website and mobile `tsc --noEmit` clean; 26 website tests
(including complete-page union and mixed-snapshot rejection), 336 native Jest
tests, Next production build and Expo web export pass. Executed Playwright
checks at 390px verify ARKK's 43 rows, AVUV's 794 rows, no whole-page horizontal
overflow, unhidden quantity columns, TSLA holders before the TM panel, raw
MSTY quantity/value columns plus CSV, and both dashboard holdings entry points.
Before/after native exports show Positions and quantities at phone and wide
widths, confirming the reported missing data was the TWA website layout.
