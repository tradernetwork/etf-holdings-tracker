# Fund expansion: what's left (as of 2026-10-14)

We went from 98 to 145 tracked funds on 2026-10-14. These are the candidates found
and not yet added. Each needs real work, so they were deferred. Selection rule used
so far: free public daily file with share counts, active or option-income, at least
$10M in assets, file dated within a few business days.

## Worth doing next

### Defiance (QQQY, IWMY, WDTE, SPYT)
- Holdings page is an HTML table: `https://www.defianceetfs.com/{ticker}-full-holdings/`
  (columns: Ticker, Name, CUSIP, ETF Weight, Shares; "as of" date on the page).
- A POST to `admin-ajax.php` with `action=download_full_holdings&slug=qqqy` returns JSON
  holding an xlsx URL (`/wp-content/uploads/xls/qqqy-10-14-2026.xlsx`). Not opened yet.
- Needs a new scraper type (`get_holdings_defiance`). Funds are small books (4 to 6 rows).
- JEPY and YDTE pages returned 404. Check AUM before committing to the work.

### More Roundhill (existing `roundhill` type, mostly just FUNDS lines)
- Bulk file already used by `get_holdings_roundhill`; about 55 funds in the Account column.
- Not added: GOOW ($85M), AAPW ($43M), AMZW ($35M), MSFW ($31M), METW ($29M), AVGW ($50M),
  ARMW ($35M), GDXW ($82M), HUMN ($87M). All are WeeklyPay-style, so they behave like the
  WeeklyPay funds already tracked.
- Passive thematic and likely out of scope: MAGS ($5.9B, swaps on the Mag 7), XBOX, METV,
  BETZ, NCLD, MARS, OZEM, NERD, LOHA.
- LYTE ($219M) was tested and dropped: about 36% of the book is China A-share codes
  (300308, 300394, 300502 ...) that the API's ticker-shape filter hides. Revisit once
  digit-leading local tickers are handled (same gap as DRAM, ~7% there). If added, it needs
  `active_book: True` plus `_ACTIVE_EQUITY_FUNDS` in `api/data.py` and `providers.ts`.

### GraniteShares (TSYY and the YieldBOOST family)
- XLS at `https://www.graniteshares.com/media/{hash}/tsyy_holdings_file_20261013.xls`
  with Shares/Par and Percentage Weighting columns.
- The `{hash}` folder has to be scraped from each fund page, and reading `.xls` needs
  `xlrd`, which isn't in `requirements.txt`. Column layout past the headers is unchecked.

## Unverified or blocked (re-check before spending time)
- JPMorgan JEPI / JEPQ: the FundsMarketingHandler excel URL returned 500, product-data null.
- T. Rowe: 403. Dimensional: guessed CSV URL 404. Simplify and Innovator: no file link found.
- Other REX leveraged single-stock ETFs on the REX home page were not tested (FEPI, AIPI,
  CEPI, ULTI, NVII, TSII are done).
- Global X also publishes AIQ, BKCH, LIT (passive thematic): skipped on purpose.

## Skipped for quality (don't re-add without a reason)
- Under $10M: GMEY, RNTY, RYLG, QCLR, XCLR, XDIV (2 rows), BRKC, QDTY, MUY, RBLY.
- Stale files (months old, probably liquidated): ABNY, DISO, FIVY (06/15/2026); JPMO
  (03/02/2026, but $50M in assets, so check whether YieldMax's feed is just broken).

## How to add a fund (the checklist that worked)
1. Probe the URL with `curl -L`; confirm 200, real CSV, recent date, shares and weight columns.
2. Add the `FUNDS` entry in `scrape_avantis.py`. New provider type means a `get_holdings_*`
   fetcher plus a branch in `fetch_fund`.
3. Run it through `fetch_fund` then `process_fund_frame` and confirm the weights sum to 100.
4. Register it in all three places: `FUND_PROVIDERS` in `api/data.py`, `FUND_PROVIDERS` in
   `etf-dashboard/lib/providers.ts`, and (new provider only) the provider lists, the
   `_OPTION_INCOME_PROVIDERS` / `OPTION_INCOME_PROVIDERS` sets, `PROVIDER_ORDER`, and
   `mobile/lib/options/logic.ts`.
5. Update the counts in `README.md` and `CLAUDE.md`, and add a Patch Notes entry.
6. Add tests (see `tests/test_yieldmax_additions.py`, `tests/test_globalx.py`) and run the
   suite. 24 notification tests fail on Windows only because `fcntl` is missing.
7. Merge, push, then trigger `scrape.yml` by hand and check `/api/v1/stats` `fundsTracked`.

TraderDaddy Pro needs nothing: it reads `/api/v1/funds` and `/api/v1/holdings` live. Its
70-fund fallback table in `syncTickerTraceHoldings.ts` is only used if that call fails.
