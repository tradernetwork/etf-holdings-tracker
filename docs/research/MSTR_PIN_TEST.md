# MSTR: do expiry closes cluster near income-ETF-written strikes?

## Preregistration — October 15, 2026

This method is committed **before fetching or inspecting MSTR price outcomes**. Holdings are the repository history through October 14, 2026 at base commit `8dfeeec`. No historical OI is available; none will be inferred from today's chain. All conclusions concern observed ETF contracts, not their share of historical OI.

### Fixed method

1. **Universe and cutoff.** Inspect every history CSV for ordinary listed MSTR options, across every fund present, not just MSTY. Exclude FLEX/off-grid or digit-prefixed adjusted roots rather than conflate them with standard contracts. Analyze completed expiries strictly before the run date. Select the most recent *file dated strictly before expiry*, with fund source dates no later than that file. This deliberately excludes expiry-day files because their actual first-publication times were not archived. A Thursday publication commonly reflects Wednesday close, so the exposure can be two sessions old: report that lag rather than call it Thursday-close inventory.
2. **Freshness and netting.** At that one snapshot, exclude a fund if any of its rows are explicitly carried (`Refreshed=False`) or its own source date is more than three calendar days behind the file date. Missing source/refresh metadata is marked unknown, not declared fresh. Sum signed contract quantities across eligible funds at `(expiry,type,strike)`, and retain both gross sides and the net. This is a position-level test, not a trade-flow test.
3. **Primary exposures.** Calls with aggregate net short **at least 1,000 contracts**, within **±15% of the prior session's unadjusted close**. All qualifying calls are considered. Puts and call thresholds100/500/5,000 are prespecified descriptive sensitivity analyses, not substitute primary tests. Today's chain is not used in the historical test.
4. **Real observed controls, not invented listings.** Historical chain listings are unavailable too. Build a candidate strike universe from standard MSTR calls actually observed in fund portfolios for the same expiry *by the selected snapshot date*. Require zero gross ETF shorts at that strike in the selected snapshot; a control may have been written earlier. Match each heavy strike to an unused control in the same signed **5-percentage-point moneyness bin** relative to prior close, on the same inferred strike grid. Infer the grid as the GCD of positive cent-valued strike differences in that expiry's pre-cutoff observed universe. Choose controls greedily in descending net-written size, then ascending strike; choose closest strike distance, tie lower strike. Unmatched heavy strikes are excluded from the paired comparison and counted. At least one matched pair is required per expiry. The comparison uses equal-sized sets of matched written and control strikes.
5. **Control limitation.** These are observed-but-unwritten controls, often protective long legs of ETF spreads. They are selected by funds and are not an unbiased sample of every exchange-listed unwritten strike. Results cannot establish general market pinning or causation. Do not silently replace them with a made-up strike lattice if matching is sparse.
6. **Prices and metrics.** Fetch daily unadjusted MSTR OHLC from Yahoo Finance's public chart endpoint (or record an explicit fallback if it fails). Preserve the downloaded response and corporate-action metadata. Use previous actual trading session's close for moneyness. Primary paired metric: distance of expiry close to nearest matched written strike minus distance to nearest matched control, each divided by prior close. Negative favors written strikes. Secondary metrics: any matched strike within1% of its strike price; any within half the inferred strike step; and fraction of matched strikes strictly straddled by expiry-session low/high. OHLC can establish a range straddle, **not the number or timing of intraday crossings**. Report all exclusion counts and effective holdings lag.
7. **Inference.** Expiry is the unit, never individual contracts. Report mean paired differences; a two-sided sign-flip permutation of expiry differences (exact for N≤20, otherwise100,000 seeded draws) supplies the primary p-value. Report a95% percentile paired bootstrap confidence interval from20,000 expiry resamples. Seed20261015. Prespecified robustness: drop expiries with unknown freshness metadata; also repeat inference using ISO-week blocks to address multiple expiries in one week. Secondary p-values, if shown, are exploratory without multiplicity correction. **Fewer than20 matched expiries = too small for a firm conclusion**, regardless of p-value. Counts and effect sizes still reported.
8. **Interpretation and limitations.** Funds may roll/close before expiry; archive coverage grows over time; no dealer or counterparty positions; MSTR is volatile; controls are spread-selected; serial dependence and sparse matched controls can weaken inference. A close-to-strike association is not evidence that ETF writing caused a pin. No trading recommendation follows from this test.

No price outcomes have been inspected at the time of this preregistration commit. Any later methodological correction must be logged separately and must not be disguised as preregistered.

## Results

Execution results follow the scope-extension registration below.

## Preregistered scope extension — October 15, 2026

After the first method commit and before running any matching/results, the user expanded the scope to **MSTR, TSLA, NVDA and COIN**. Apply exactly the same thresholds, cutoffs, matching and per-expiry statistics separately to each. Also report a pooled mean across underlying-expiry observations, with **calendar ISO-week cluster** sign flips and bootstrap resamples shared across all symbols, rather than treating correlated same-week stock outcomes as independent. Report per-symbol N, pooled observations and distinct weeks. Preserve the original MSTR-only document filename for continuity. This changes scope, not exposure/control selection after seeing outcomes.


## Executed results — October 15, 2026

**No convincing evidence of an ETF pinning effect.** The preregistered MSTR contrast is null:22 matched expiries, p=0.759, with closes slightly **farther** from the written strikes. Across all four symbols, written strikes are closer by0.412 percentage points of prior close, but the primary calendar-week-cluster sign-flip gives **p=0.0567**. This is not a passed5% test. It is an observational proximity comparison with selected controls, not a causal test of price attraction.

NVDA's unadjusted p≈0.015 is the tempting result. It has only16 matched expiries, below the preregistered20 minimum, and multiplying by four for the four symbol tests gives about0.060. More importantly, its written set was already closer to the prior close than its control set. Do not turn that result into “NVDA call walls work”.

### Source, cutoff and reproducibility

- Preregistration commits: `b6ac87f` (MSTR) and `2dec5cb` (four-symbol extension), before executing the study. This is a local timestamped preregistration, not an independently hosted trial registry.
- Holdings: **166 history CSVs**, checksummed in the result JSON. The last CSV is2026-10-14; tested matched expiries span2026-03-13 through2026-10-09. No expiry-day holdings file or future price outcome determines strike selection. Earlier raw portfolios with missing freshness metadata remain explicitly unknown.
- Prices: Yahoo Finance's public `query1.finance.yahoo.com/v8/finance/chart/{symbol}` daily quote OHLC, not the `adjclose` series. No split events were returned in the requested window; the script refuses to continue if a split requires normalization. Yahoo can split-normalize historical quotes, so “unadjusted” here means no dividend/total-return adjustment and comparable units within this split-free window. [Yahoo historical-price reference](https://finance.yahoo.com/quote/MSTR/history/).
- Four exact responses, download timestamps, request URLs and SHA256 values are committed under [pin_prices_2026-10-15](pin_prices_2026-10-15/manifest.json). No historical OI was fetched or reconstructed, and today's chain is not an input to this study.
- Full80-observation results, all51 exclusions, inference and threshold sensitivities: [pin_results_2026-10-15.json](pin_results_2026-10-15.json). Flattened audit rows: [pin_observations_2026-10-15.csv](pin_observations_2026-10-15.csv).

Offline reproduction (standard-library Python3.10+; no packages/network required):

```bash
python3 scripts/research/etf_pin_test.py \
  --history etf-dashboard/public/data/history \
  --prices-dir docs/research/pin_prices_2026-10-15 \
  --as-of 2026-10-15 --output /tmp/pin-reproduction
python3 -m unittest discover -s tests -p test_etf_pin_research.py -v
```

The committed history manifest defines the historical input boundary. If new history files have landed, use a checkout of this PR's input commit or pass a directory containing only manifest-listed files; the fixed expiry cutoff alone does not freeze an expanding candidate-expiry universe. A second offline execution reproduced all observations, exclusions, statistics and sensitivity results exactly.

### Primary close-distance test

Distance is normalized by prior-session close. Effects below are **percentage points of prior close**, written minus control: negative favors written. Means are across expiry observations, not weighted by contract count.

| Symbol | Matched expiries | Excluded expiries | Mean written distance | Mean control distance | Difference (pp) |95% bootstrap CI (pp) | Two-sided p |
|---|---:|---:|---:|---:|---:|---|---:|
| MSTR | 22 | 11 | 6.253% | 6.137% | +0.116 | [-0.634, +0.801] | 0.7588 |
| TSLA | 22 | 11 | 4.022% | 4.406% | -0.385 | [-1.046, +0.286] | 0.2822 |
| NVDA | 16 | 17 | 3.472% | 4.580% | -1.108 | [-1.816, -0.353] | 0.0150 |
| COIN | 20 | 12 | 4.852% | 5.320% | -0.468 | [-1.444, +0.562] | 0.3780 |
| Pooled (week-clustered) | 80 observations / 27 weeks |51 | 4.733% | 5.145% | -0.412 | [-0.801, -0.013] | 0.0567 |

The pooled percentile bootstrap CI narrowly excludes zero while its sign-flip p-value is above0.05. Both are reported as preregistered: they are different finite-sample procedures, not algebraic inverses. Do not select the favorable interval and call the primary test significant. Per-symbol ISO-week-cluster sensitivity equals the per-expiry result because each symbol has at most one matched expiry per week. Pooled inference shares sign flips/resampled weeks across correlated symbols.

### Close-hit and final-session range tests

Each hit rate is the fraction of expiries where **any** member of its equal-size strike set meets the criterion. Range-straddle is first averaged across strikes within an expiry, then across expiries; it is not the fraction of expiries with any straddle. “W/C” is written versus control.

| Symbol | Close within1% (W/C) | Close within half a strike-step (W/C) | Range-straddled strike fraction (W/C) |
|---|---:|---:|---:|
| MSTR | 13.6% / 13.6% | 13.6% / 4.5% | 19.8% / 22.4% |
| TSLA | 18.2% / 18.2% | 4.5% / 9.1% | 33.8% / 25.8% |
| NVDA | 25.0% / 12.5% | 25.0% / 0.0% | 34.4% / 18.8% |
| COIN | 25.0% / 15.0% | 20.0% / 10.0% | 30.8% / 30.4% |
| Pooled | 20.0% / 15.0% | 15.0% / 6.2% | 29.3% / 24.6% |

As an additional descriptive denominator check (not a new preregistered test), at least one matched strike is range-straddled on MSTR8/22 written versus7/22 control expiries; TSLA9/22 versus6/22; NVDA7/16 versus4/16; and COIN9/20 versus8/20. This differs from averaging the within-expiry fraction of strikes: both denominators are stated rather than conflated.

MSTR finishes within1% on3/22 expiries for both sets. There is no consistent lower range-straddle pattern: pooled written strikes are straddled **more** often (29.3% versus24.6%), not less. OHLC cannot say how many crossings happened, whether there was a closing-auction effect, or which strike was crossed last. These secondary rates are descriptive, not additional positive hypothesis tests.

### Matching and data limitations that matter to the conclusion

1. **Coverage/freshness dominates confidence.**75/80 matched observations include at least one relevant fund with unknown historical freshness metadata. They are not necessarily stale; the archive simply cannot attest freshness. The preregistered known-metadata-only rerun leaves just5 observations in2 weeks; pooled p=0.5. That is far too small for a conclusion.
2. **Exposure lag.**Every matched case uses a file dated one calendar day before expiry. Under the prior-close publication convention that commonly means positions at the close two sessions before expiry. Funds can roll in between. The archive's date is not proof of actual trade time.
3. **Sparse, selected controls.**All51 exclusions are no-matched-heavy-strike cases, combining no qualifying exposure and failed matching; no excluded expiry was silently assigned a zero outcome. Historical listing universes are unavailable. Controls are real contracts previously observed in fund holdings, but are often protective spread legs, and may have been written previously. Unobserved short exposure outside tracked funds is unknown.
4. **Coarse matching leaves a baseline difference.**The5pp moneyness-bin rule is fixed in the preregistration, but it does not match exact moneyness. The post-run diagnostic below shows written strikes were already nearer the prior close. This is a diagnostic of design limitations, **not a newly chosen primary test**.

| Symbol | Matched strike pairs | Unmatched heavy strikes within included expiries | Written-minus-control distance at prior close (pp) | Controls above written strike |
|---|---:|---:|---:|---:|
| MSTR | 47 | 87 | -0.309 | 25/47 |
| TSLA | 42 | 47 | -0.827 | 32/42 |
| NVDA | 23 | 22 | -0.911 | 21/23 |
| COIN | 36 | 37 | -0.503 | 28/36 |

NVDA's1.108pp expiry advantage is preceded by a0.911pp prior-close advantage. This undermines a price-attraction interpretation. More generally, sign-flip p-values assume suitable symmetry/exchangeability of paired differences; the non-random spread-selected controls do not establish it. Treat the p-values as exploratory reference values for this conditional comparison, not an experimental randomization guarantee.

5. **Actual fund coverage.**Relevant portfolios in the included matched snapshots contain CHPY, CONY, EGGS, KQQQ, MSTW, MSTY, NVDY, QDVO, SLTY, TSLY, ULTI and ULTY. That list includes long holders, not just writers of the matched strikes. Coverage grows during the archive; Builder's newly added funds have no retrospective history and are not backfilled into the test. No nationwide ETF exposure claim follows.
6. **No historical OI or counterparties.**Absolute net-written quantities define exposures. There is no historical OI denominator, market-wide call wall, dealer gamma, options closing flow or causal instrument in this study.

### Prespecified descriptive sensitivities

Different thresholds change the matched sample and may not be compared as if the population were fixed. Positive effect means farther from written strikes.

| Exposure definition | MSTR N / effect pp | TSLA N / effect pp | NVDA N / effect pp | COIN N / effect pp |
|---|---|---|---|---|
| calls100 | 22 / +0.116 | 23 / -0.395 | 22 / -0.676 | 20 / -0.468 |
| calls500 | 22 / +0.116 | 22 / -0.385 | 17 / -0.920 | 20 / -0.468 |
| calls5000 | 21 / +0.085 | 16 / -0.484 | 15 / -1.104 | 11 / -0.235 |
| puts1000 | 0 / not estimable | 0 / not estimable | 4 / +0.561 | 0 / not estimable |

Puts provide only4 matched NVDA expiries and none for the other symbols, so do not support a put-pinning conclusion. Threshold changes do not rescue a strong MSTR result.

### Every matched MSTR expiry

Prices and strikes are in dollars; distance differences use the prior close, not the expiry close. Complete four-symbol rows and exclusions remain in the JSON/CSV evidence.

| Expiry | Selected file | Expiry close | Written strikes | Matched controls | Difference pp |
|---|---|---:|---|---|---:|
| 2026-03-13 | 2026-03-12 | 139.67 | 147, 148 | 149, 150 | -1.456 |
| 2026-03-20 | 2026-03-19 | 135.66 | 150, 148 | 149, 147 | +0.723 |
| 2026-04-02 | 2026-04-01 | 119.83 | 130, 131 | 129, 132 | +0.814 |
| 2026-04-10 | 2026-04-09 | 128.64 | 129, 130 | 131, 132 | -1.552 |
| 2026-04-24 | 2026-04-23 | 171.02 | 180, 170, 182.5 | 177.5, 165, 185 | -2.899 |
| 2026-05-01 | 2026-04-30 | 177.17 | 167.5 | 170 | +1.511 |
| 2026-05-08 | 2026-05-07 | 187.59 | 180, 192.5 | 187.5, 190 | +2.680 |
| 2026-05-22 | 2026-05-21 | 159.89 | 180, 182.5 | 177.5, 185 | +1.517 |
| 2026-05-29 | 2026-05-28 | 159.09 | 170 | 172.5 | -1.649 |
| 2026-06-12 | 2026-06-11 | 123.97 | 133 | 134 | -0.832 |
| 2026-06-18 | 2026-06-17 | 112.53 | 132, 127, 128, 122 | 131, 125, 124, 120 | +1.716 |
| 2026-07-02 | 2026-07-01 | 100.77 | 89, 90 | 91, 92 | +2.142 |
| 2026-07-10 | 2026-07-09 | 94.64 | 105, 98 | 104, 97 | +1.065 |
| 2026-07-17 | 2026-07-16 | 94.85 | 99 | 103 | -4.254 |
| 2026-07-24 | 2026-07-23 | 91.67 | 101, 96.5 | 100, 96 | +0.534 |
| 2026-08-07 | 2026-08-06 | 100.01 | 97, 96, 98 | 98.5, 93, 101 | +1.053 |
| 2026-08-21 | 2026-08-20 | 119.25 | 97.5, 105, 96.5 | 98.5, 104, 101 | -0.890 |
| 2026-08-28 | 2026-08-27 | 127.31 | 124, 117, 126, 122, 127 | 128, 120, 129, 121, 130 | -0.277 |
| 2026-09-04 | 2026-09-03 | 142.80 | 136 | 137 | +0.691 |
| 2026-09-18 | 2026-09-17 | 153.92 | 139, 135, 140 | 141, 134, 142 | +1.512 |
| 2026-09-25 | 2026-09-24 | 158.61 | 142, 150 | 141, 148 | -1.238 |
| 2026-10-09 | 2026-10-08 | 154.34 | 170 | 167.5 | +1.650 |

**Decision:** do not ship a pinning prediction or describe income-ETF strikes as proven price magnets. The footprint research still supports showing disclosed contracts and carefully date-qualified concentration. A stronger pin test needs archived effective-date portfolios, genuinely comparable listed unwritten strikes, expiry-session intraday paths and more independent weeks. This result is not investment advice.
