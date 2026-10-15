# Income ETF option positions versus listed open interest

Research snapshot: **October 15, 2026, approximately 19:39–19:40 UTC**. Research only; no scraper, API, app or production changes. Base repository snapshot: `e85bbd1` (145 tracked funds).

## Answer

**Yes, the disclosed portfolios are large enough to explain a meaningful fraction of the short side at particular strikes. They do not reconstruct a complete option chain.** In the latest CHPY file, tomorrow's MU **$955 calls have 646 reported shorts versus 1,173 OI (55.07%)**. Its protective **$965 calls have 646 reported longs versus 1,204 OI (53.65%)**. Those are different sides at different strikes. Across all Oct 16 MU calls, the observed funds report only **716 shorts / 336,857 OI = 0.213%**.

The important limitation is timing: these are **reported position/OI comparisons**, not proof of today's opening trades or dealer gamma. The newest Tidal file has a publication-like `Date=10/15/2026`; its valuation marks strongly support Oct 14 close. Same-close attribution is an inference, explained below. This research does **not** establish an exhaustive census of every US ETF; blocked and unchecked issuer feeds are explicitly identified. Unknown exposure is never counted as zero.

## Timing: what does “10/15” mean?

- CHPY's and YRAM's 10/15 CSVs both mark MU shares at **$914.13**, exactly the Cboe chain's **previous-day close**, versus today's opening $871.25 and snapshot $921.305. That is strong evidence for Oct 14 valuation, not intraday Oct 15 valuation. The quantity snapshot is therefore most plausibly the prior-close disclosure, but old marks alone do not prove that no quantities were edited intraday.
- The [ETF disclosure rule, 17 CFR 270.6c-11(c)(1)(i) and (c)(2)](https://www.ecfr.gov/current/title-17/chapter-II/part-270/section-270.6c-11) requires the pre-open disclosed portfolio underlying the next NAV calculation to be the prior-business-day portfolio. This supports the interpretation for transparent daily holdings; it is not issuer-specific attestation that this particular download was that pre-open file.
- [Cboe's DataShop FAQ](https://datashop.cboe.com/faqs) identifies the OI convention as the previous night's OCC end-of-day value. Thus the Oct 15 chain normally carries Oct 14 OI. The JSON does not expose a separate OI date, so store that as inferred, alongside the actual chain timestamp.
- The archive's Oct 14 CHPY rows still show −645 C1065 / +645 C1095, plus a one-contract −C955/+C970 spread. The current CSV instead shows −646 C955/+646 C965. Those archives are retrieval/publication snapshots, **not execution timestamps**. Their diff cannot by itself settle the trade date.
- If the 646-contract roll actually happened Oct 15, those contracts may not be in this morning's OI. In that case 55.07% is a mismatched-date comparison, **not an ownership share**. Intraday volume does not solve this: volume includes closes and repeated turnover. Tomorrow's OI change would be a consistency check, not unique trade attribution.

| Issuer/feed | Date evidence in captured files | Treatment |
|---|---|---|
| YieldMax/Tidal | 10/15 rows; CHPY/YRAM equity marks equal Oct 14 close | Prior-close inferred; show both dates and qualification |
| Roundhill bulk Tidal | Filename `10142026`; rows dated 10/15; CHAT/DRAM MU marked $914.13 | Filename and row date are different concepts; same prior-close inference |
| REX POST CSV | No date column; MU market value / shares = $914.13 in FEPI, AIPI and CEPI | Valuation date inferred Oct 14; quantity date unverified |
| Kurv CSV | No date column in the direct export | Quantity date unknown; ratios provisional, never date-aligned by default |
| Amplify Firestore | Date returned by issuer feed / snapshot, retained in evidence CSV | Preserve issuer date; do not silently relabel it as today's holdings |
| Global X / other existing feeds | Existing 10/14 tracked snapshot where not independently refreshed | Coverage screen only; no fresh MU numerator inferred |
| GraniteShares MUYY | XLS says Position Date 10/15, filename 10/14 | Separate leveraged-ETF root; not comparable to MU OI |
| Simplify bulk workbook | Explicit 10/14 EOD file | Prior-close explicit; MU-linked structured product excluded |

A production version should archive immutable **pre-open** downloads with UTC first-seen time, issuer publication date, effective holdings date and OI effective date separately. Only verified aligned dates get an attribution percentage. Otherwise display the two quantities side by side with “dates not verified”. This research could not capture the earlier pre-open version retrospectively.

## MU: latest directly disclosed listed-option holders

AUM is issuer `NetAssets` where present. For Kurv/REX, “≈” denotes sum of published net market values, a holdings-value proxy rather than independently verified AUM. Currency formatting is removed before summing. Download time is Oct 15; an undated export remains undated.

| Fund | AUM / holdings-value proxy | In `FUNDS`? | Listed MU positions observed | Source / format |
|---|---:|---|---|---|
| CHPY | $1,274.84M | Yes | -646 10-16 C955, +646 10-16 C965 | [CSV](https://yieldmaxetfs.com/wp-content/uploads/funds/CHPY/TidalFG_Holdings_CHPY.csv) |
| MUY | $3.85M | No | -10 10-16 C1055, -5 10-23 C1000, +5 10-23 C1050, +5 10-23 C1040, +10 10-16 C1105, -5 10-23 C990 | [CSV](https://yieldmaxetfs.com/wp-content/uploads/funds/MUY/TidalFG_Holdings_MUY.csv) |
| YRAM | $8.05M | No | +13 10-23 C990, -13 10-23 C950 | [CSV](https://yieldmaxetfs.com/wp-content/uploads/funds/YRAM/TidalFG_Holdings_YRAM.csv) |
| KQQQ | ≈$133.96M | Yes | -60 10-16 C1200, +16 12-18 P910 | [CSV](https://web.services.kurvinvest.com/etfdata/KQQQ/holdings.csv) |
| KYLD | ≈$52.21M | Yes | -23 10-23 C1100 | [CSV](https://web.services.kurvinvest.com/etfdata/KYLD/holdings.csv) |
| BIGY | $32.59M | Yes | +8 11-20 C1220, -8 11-20 C1160 | [CSV](https://yieldmaxetfs.com/wp-content/uploads/funds/BIGY/TidalFG_Holdings_BIGY.csv) |
| SOXY | $63.54M | Yes | +32 11-20 C1040, -32 11-20 C1000 | [CSV](https://yieldmaxetfs.com/wp-content/uploads/funds/SOXY/TidalFG_Holdings_SOXY.csv) |
| FEPI | ≈$735.18M | Yes | -2 11-20 C1000, -527 11-20 C1020 | [CSV POST (`CSV=Download CSV`, `symbol=FEPI`)](https://www.rexshares.com/fepi/) |
| AIPI | ≈$491.47M | Yes | -3 11-20 C990, -138 11-20 C1010 | [CSV POST (`CSV=Download CSV`, `symbol=AIPI`)](https://www.rexshares.com/aipi/) |
| CEPI | ≈$123.13M | Yes | -1 11-20 C980, -61 11-20 C1010 | [CSV POST (`CSV=Download CSV`, `symbol=CEPI`)](https://www.rexshares.com/cepi/) |

These ten funds are **confirmed in the inspected feeds**, not a claim that there are only ten nationwide. KQQQ also has a listed Dec 18 $910 put. KMEM holds only the excluded MU-prefixed synthetic/FLEX pair in this capture, so is not a listed-MU holder here.

### Tomorrow, Oct 16: every observed listed leg

| Strike/type | Fund | Reported short | Reported long | Listed OI | Short / OI | Long / OI |
|---|---|---:|---:|---:|---:|---:|
| $955 C | CHPY | 646 | 0 | 1,173 | 55.07% | 0.00% |
| $965 C | CHPY | 0 | 646 | 1,204 | 0.00% | 53.65% |
| $1055 C | MUY | 10 | 0 | 1,088 | 0.92% | 0.00% |
| $1105 C | MUY | 0 | 10 | 951 | 0.00% | 1.05% |
| $1200 C | KQQQ | 60 | 0 | 11,492 | 0.52% | 0.00% |

CHPY's earlier 1065/1095 spread from the Oct 14 archive gives 645/1,860 = 34.68% short and 645/1,274 = 50.63% long against this chain. Those **are not the latest disclosed positions** and must not be presented as current walls. SOXY's old Oct 16 spread has likewise rolled into November in its current file.

### Whole expiries, including the next three listed expiries

“Observed” means inspected direct contracts, not every ETF in existence. Calls only in the numerator; long calls are shown separately and must not be added to shorts as unique contracts.

| MU expiry | Call OI | Put OI | Observed short calls | Observed long calls | Short / all call OI |
|---|---:|---:|---:|---:|---:|
| 2026-10-16 | 336,857 | 316,202 | 716 | 656 | 0.21% |
| 2026-10-19 | 19,147 | 11,028 | 0 | 0 | 0.00% |
| 2026-10-21 | 13,774 | 7,681 | 0 | 0 | 0.00% |
| 2026-10-23 | 47,767 | 59,321 | 46 | 23 | 0.10% |
| 2026-10-30 | 61,593 | 38,141 | 0 | 0 | 0.00% |
| 2026-11-06 | 13,249 | 20,429 | 0 | 0 | 0.00% |
| 2026-11-20 | 154,046 | 175,385 | 772 | 40 | 0.50% |

### Later strikes with disclosed positions

| Expiry | Strike/type | Reported shorts | Reported longs | OI | Short/OI | Long/OI | Funds (signed contracts) |
|---|---|---:|---:|---:|---:|---:|---|
| 2026-10-23 | 950C | 13 | 0 | 912 | 1.43% | 0.00% | YRAM:-13.0 |
| 2026-10-23 | 990C | 5 | 13 | 438 | 1.14% | 2.97% | MUY:-5.0;YRAM:13.0 |
| 2026-10-23 | 1000C | 5 | 0 | 4388 | 0.11% | 0.00% | MUY:-5.0 |
| 2026-10-23 | 1040C | 0 | 5 | 656 | 0.00% | 0.76% | MUY:5.0 |
| 2026-10-23 | 1050C | 0 | 5 | 1598 | 0.00% | 0.31% | MUY:5.0 |
| 2026-10-23 | 1100C | 23 | 0 | 2140 | 1.07% | 0.00% | KYLD:-23.0 |
| 2026-11-20 | 980C | 1 | 0 | 640 | 0.16% | 0.00% | CEPI:-1.0 |
| 2026-11-20 | 990C | 3 | 0 | 616 | 0.49% | 0.00% | AIPI:-3.0 |
| 2026-11-20 | 1000C | 34 | 0 | 4636 | 0.73% | 0.00% | SOXY:-32.0;FEPI:-2.0 |
| 2026-11-20 | 1010C | 199 | 0 | 1166 | 17.07% | 0.00% | AIPI:-138.0;CEPI:-61.0 |
| 2026-11-20 | 1020C | 527 | 0 | 1325 | 39.77% | 0.00% | FEPI:-527.0 |
| 2026-11-20 | 1040C | 0 | 32 | 1740 | 0.00% | 1.84% | SOXY:32.0 |
| 2026-11-20 | 1160C | 8 | 0 | 803 | 1.00% | 0.00% | BIGY:-8.0 |
| 2026-11-20 | 1220C | 0 | 8 | 580 | 0.00% | 1.38% | BIGY:8.0 |
| 2026-12-18 | 910P | 0 | 16 | 964 | 0.00% | 1.66% | KQQQ:16.0 |

At Nov 20 C1010, AIPI and CEPI together report 199 shorts / 1,166 OI = **17.07%**. FEPI's Nov 20 C1020 is **527 / 1,325 = 39.77%** (quantity date unverified). At Oct 23 C990, MUY is short five while YRAM is long thirteen. Do not net them away, and do not call their sum eighteen distinct open contracts: some may be opposite sides of the same contracts.

## FLEX, swaps, wrappers and issuer census

| Issuer / funds screened | Finding for direct listed MU contracts | Coverage or source |
|---|---|---|
| YieldMax: all fund-page tickers exposed by current directory, plus tracked CSV funds | CHPY, SOXY, BIGY, MUY and YRAM confirmed; other retrieved funds no additional direct MU legs | [Directory](https://yieldmaxetfs.com/our-etfs/); 21 additional feeds attempted beyond initial universe, 20 succeeded; YSKH unavailable, so unknown |
| YMAX / YMAG | Fund-of-funds: do not count owned ETF shares as more option contracts | Direct issuer CSVs inspected. Count underlying fund's portfolio once; do not add look-through a second time |
| Roundhill: 55 accounts in shared file | No direct MU options found; CHAT and DRAM hold MU equity; WeeklyPay wrappers do not establish dealer option positions | [Bulk CSV](https://www.roundhillinvestments.com/assets/data/FilepointRoundhill.40RU.RU_Holdings_10142026.csv), rows dated 10/15; covers tracked and untracked accounts |
| Kurv: current catalog CSVs | KYLD and KQQQ listed MU; KMEM only synthetic/FLEX MU in this capture | [Catalog](https://www.kurvinvest.com/etfs); all catalog ticker feeds retrieved; an extra guessed obsolete NVDP URL failed and is not treated as a live fund |
| REX: ULTI, NVII, TSII, FEPI, AIPI, CEPI | FEPI, AIPI and CEPI confirmed; no additional MU legs in others' downloaded portfolios | POST download on each fund page, same payload as source table |
| GraniteShares MUYY | **No MU-root legs**: XLS holds `2MULL` put spreads referencing leveraged MULL, not MU. Exclude every one from MU OI | [Issuer](https://graniteshares.com/etfs/muyy/), [captured XLS](https://graniteshares.com/media/qozijekh/muyy_holdings_file_20261014.xls). Position Date10/15. AUM ≈$10.775M =610,001 shares×$17.663594 NAV. Other YieldBOOST funds are not comprehensively contract-screened here |
| Direxion MUIB | MU-linked strategy confirmed, but **direct listed contracts not established**. The prospectus says exposure is principally swaps. No dealer look-through numerator | [Fund page](https://www.direxion.com/product/mu-defined-income-boost-etf-muib); [SEC prospectus](https://www.sec.gov/Archives/edgar/data/1424958/000119312526321412/d27003d497k.htm). Direct page fetch403; browser-search accessible page's CSV link resolves back to itself. Current AUM/contract CSV not verified |
| Defiance | Catalog reviewed; no verified MU income portfolio retrieved. MUZ is inverse leverage, not proof of MU call writing | [Catalog](https://www.defianceetfs.com/explore-our-etfs), [MUZ](https://www.defianceetfs.com/muz/). Do not treat all Defiance funds as audited or zero |
| Amplify DIVO/QDVO/IDVO | No listed MU legs in inspected portfolios | Issuer Firestore feed / dated evidence; other new Amplify products not comprehensively screened |
| Global X: eight covered-call funds in tracked snapshot | No listed MU-root options in that snapshot; holding MU stock plus index calls is not MU call ownership | [QYLD](https://www.globalxetfs.com/funds/qyld); latest repo snapshot10/14, not an independent fresh census |
| NEOS: six tracked funds' CSVs | No listed MU options in downloaded files; index calls and MU shares must not be expanded into MU contracts | Issuer `wp-admin/admin-ajax.php?action=download_holdings_csv&ticker=...` feeds in manifest |
| Simplify: all43 workbook fund codes | XXV contains `MU 09/17/27 P100/60 EKI NC1`, quantity−2,000,000; this is a structured exposure, **not two million listed puts**. No standard MU leg found | [All-funds EOD workbook](https://www.simplify.us/sites/default/files/excel_holdings/2026_10_14_Simplify_Portfolio_EOD_Tracker.xlsx),10/14. XLSX, first sheet header row2 |
| Bitwise | No MU-specific income ETF established. Do not resurrect IMST/ICOI as live candidates: issuer liquidation notices say closed July31,2026 | [IMST notice](https://imstetf.com/), [ICOI notice](https://icoietf.com/). Not an exhaustive audit of every remaining Bitwise income product |
| Other Tidal managers / JPMorgan / BlackRock / long tail | Existing tracked snapshot screened for normalized MU option legs, but nationwide coverage remains incomplete | NestYield/NicholasX and existing snapshot are a coverage screen, not a fresh every-manager audit. ELN/swap exposure cannot be assigned to listed chains without counterparty detail |

Separate excluded MU-prefixed synthetic/FLEX legs: MUY Nov20 C1050.01 +43 / P1050.01 −43; KYLD Dec18 C930 +23 / P930 −23; KQQQ same pair ±75; KMEM same pair ±40. No conversion of FLEX or swap notional into a standard-chain contract count. The repo's leading-digit/off-grid classifier is a heuristic: adjusted listed roots can also start with digits, so production must resolve actual contract identity/deliverable rather than assume every numeric prefix proves FLEX.

## Fifteen-underlying check

The set was chosen for income-fund relevance, not a claim of a ranked national “top15”. These ratios use inspected listed short calls only, with negative contract quantities converted to positive counts. Peaks are within captured live expiries; a tiny denominator can create a large percentage. Fresh Tidal, undated Kurv/REX, Roundhill and dated Amplify sources have different timing confidence. The evidence CSV retains the constituent funds and dates for every strike. None of the ratios proves execution time or price resistance.

| Underlying | Oct16 reported short calls / call OI | Ratio | Largest observed strike concentration | Contracts / OI | Ratio | # strikes ≥10% |
|---|---:|---:|---|---:|---:|---:|
| MU | 716 / 336,857 | 0.21% | 2026-10-16 C955 | 646 / 1,173 | 55.07% | 3 |
| NVDA | 40,365 / 1,065,041 | 3.79% | 2026-10-16 C232.5 | 35,024 / 49,514 | 70.74% | 1 |
| TSLA | 16,631 / 436,724 | 3.81% | 2026-10-16 C377.5 | 3,700 / 6,089 | 60.77% | 5 |
| MSTR | 56,038 / 344,641 | 16.26% | 2026-10-16 C157.5 | 36,425 / 41,134 | 88.55% | 5 |
| COIN | 16,374 / 139,288 | 11.76% | 2026-10-16 C177.5 | 2,900 / 3,287 | 88.23% | 5 |
| PLTR | 17,838 / 230,390 | 7.74% | 2026-10-16 C207.5 | 12,022 / 14,796 | 81.25% | 4 |
| AMD | 6,038 / 203,647 | 2.96% | 2026-10-16 C617.5 | 2,000 / 2,409 | 83.02% | 8 |
| HOOD | 9,716 / 208,320 | 4.66% | 2026-10-23 C107 | 1,215 / 1,622 | 74.91% | 5 |
| AAPL | 4,695 / 469,371 | 1.00% | 2026-10-16 C322.5 | 315 / 595 | 52.94% | 3 |
| AMZN | 8,775 / 416,977 | 2.10% | 2026-10-16 C262.5 | 5,520 / 15,254 | 36.19% | 4 |
| GOOGL | 7,815 / 435,169 | 1.80% | 2026-10-16 C357.5 | 3,710 / 8,218 | 45.14% | 2 |
| META | 1,799 / 353,061 | 0.51% | 2026-10-16 C735 | 1,655 / 2,700 | 61.30% | 1 |
| MSFT | 1,925 / 393,254 | 0.49% | 2026-10-16 C537.5 | 935 / 2,829 | 33.05% | 3 |
| AVGO | 2,086 / 222,670 | 0.94% | 2026-10-16 C375 | 1,864 / 7,183 | 25.95% | 4 |
| NFLX | 4,976 / 315,995 | 1.57% | 2026-11-20 C77.5 | 7,002 / 12,011 | 58.30% | 3 |

This is economically meaningful: MSTR's inspected short calls represent about16.26% of the entire Oct16 call OI; several single strikes exceed50%. It is also selective: MU is only0.213% across that whole expiry. “A huge fraction at one selected strike” and “a tiny fraction of the entire chain” can both be true. These are incomplete-coverage estimates, not a complete national ETF total. Missing funds may increase the observed short-side numerator, but stale timing may also make the current estimate too high; **not a mathematically guaranteed lower bound**.

## Product verdict and candidate additions

**Proceed to a small historical validation, not an immediate “call wall” trading signal.** A useful screen would show “Reported ETF short calls”, “Reported ETF long calls” and “Listed OI”, with side-specific ratios only when dates match. Expand a strike to the named funds, signed contracts and source/effective dates. Show FLEX/synthetic and swap exposures separately. A spread's protective long call can be just as concentrated as its short call; suppressing it would tell half the story.

Market makers may be on the other side, or other funds/customers may be. Public ETF positions alone cannot identify the counterparty, net dealer gamma, opening/closing flows, hedge timing or a future price pin. Do not label the result “all income funds”, “X% of OI explained” or “resistance” without the missing coverage and effective-date controls. OI counts contracts, not both counterparties separately ([OCC education](https://www.optionseducation.org/referencelibrary/faq/general-information)). Check market-data redistribution rights before shipping a chain-derived commercial feature; this PR contains research derivatives, not full raw chains.

| Candidate (not added) | Priority | Why / gate |
|---|---|---|
| **MUY** | High | Direct listed MU weekly spreads and clear Tidal CSV; $3.85M issuer NetAssets is below the earlier $10M ingestion floor, so needs an explicit small-fund exception |
| **YRAM** | High | New memory/storage basket; direct MU Oct23 spread; $8.05M likewise below that floor; standard Tidal CSV |
| **KMEM** | Medium | ≈$24.50M net holdings value; memory exposure useful, but its MU option exposure here is synthetic/FLEX only. Do not sell this as adding listed-MU OI coverage |
| **MUIB** plus GOIB/MEIB/NVIB/PLIB/TSIB | Investigate | Issuer filings establish swap-led replication. Resolve daily holdings/AUM first; add for holdings visibility, not invented listed-option look-through |
| **GraniteShares MUYY / wider YieldBOOST suite** | Separate chain universe | Public XLSX/XLS ingestion and leveraged-underlying root mapping needed; MUYY adds **MULL**, not MU, chain coverage |
| Remaining live YieldMax CSV funds in manifest | Medium | 20 additional retrieved portfolios extend the15-underlying universe; screen AUM, launch/closure status and feed freshness before proposing each. YSKH remains unavailable |
| Defiance / other live single-stock writers | Coverage backlog | First establish current portfolio files and real listed contracts; no guessed quantities or national coverage claim |

## Evidence and reproducibility

- `income_oi_strikes_2026-10-15.csv`: all inspected listed positions for the15 underlyings, separate gross short/long counts, OI, constituent funds, issuer dates and chain timestamp. An empty/undated date is not silently filled.
- `income_oi_summary_2026-10-15.json`: expiry-wide denominators, totals and per-underlying peaks. “All expiries” is only the contracts returned by these chain captures.
- `income_oi_positions_2026-10-15.csv`: signed source-position inputs for those underlyings, including excluded FLEX flags.
- `income_oi_fund_inventory_2026-10-15.json`: per-fund URL, dates, tracked status, assets/proxy and failed retrievals for the inspected universe.
- `income_oi_manifest_2026-10-15.json`: byte counts and SHA256 hashes of local issuer/chain captures. Raw mutable feeds are retained locally at `/tmp/tt-oi-raw` for review, not committed wholesale. The manifest documents exactly what was used; without those archived bytes it does not recreate a historical vendor response.

Reproduction: fetch issuer CSVs from the inventory and `https://cdn.cboe.com/api/global/delayed_quotes/options/{SYMBOL}.json`; parse `(actual root, expiry, call/put, strike, deliverable)`; preserve signed quantities and FLEX/adjusted classification. Group short and long sides separately, never net across funds. Match only exact contracts. For a side-specific ratio use `sum(short contracts)/open_interest` or `sum(long contracts)/open_interest`; denominator zero/missing means unknown, never0%. Deduplicate fund-of-funds ownership. For each expiry, divide matched short calls by **all** listed call OI in that expiry, not just held strikes. Source files were downloaded in parallel with bounded concurrency; no production endpoints were modified or scrape jobs triggered.

This research is evidence for a feature, not investment advice. Remaining work is an exhaustive live issuer registry, immutable pre-open capture, contract/deliverable resolution and a multi-day alignment backtest. Until then the honest headline is **large reported concentrations at specific strikes, with incomplete coverage and date qualifications**.
