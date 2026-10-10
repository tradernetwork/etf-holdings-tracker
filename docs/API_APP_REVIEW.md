# PR #142 review corrections

Cross-fund symbol-only sector donation is removed. A unique donor sector does
not establish security identity: S, EFX and RKT collide across exchanges, and
CASH is not an equity identifier. Only the existing curated fallback applies.
Regression fixtures cover every reported collision; unknown labels stay blank.

Unknown fund AUM returns null for legacy billions and whole-dollar fields.
Incomplete layering AUM and estimated position totals also return null; scoring
uses only known AUM internally. Existing same-day CSV correction invalidation
remains intact.

Changes and signal construction resolve each participating fund once per
calculation, then reuse the value for position estimates, rows and scoring.
The cache is local to the calculation, so it cannot survive a snapshot change.

## Warm latency

Real checked-in history: 162 CSV files. Separate in-process runs, no simultaneous
tests/benchmarks, one warm-up per endpoint followed by five perf_counter samples;
minimum reported. Original data.py is revision b1c9870, pre-review is 34dfcab.
Both use the exact same HISTORY_DIR as the corrected branch. Times are ms.

| Function | Original baseline (repeat) | Pre-review | Corrected | vs repeat baseline |
| --- | ---: | ---: | ---: | ---: |
| compute_daily_changes_with_options | 291.894 | 527.231 | 286.640 | -1.80% |
| get_signals | 3043.830 | 3516.435 | 3092.684 | +1.61% |

Initial original-baseline minima were 312.219 / 2966.950 ms respectively.
Corrected signals are +4.24% against that faster initial signal baseline too;
both final functions meet the requested approximately 5% ceiling. Repeat
baselines make normal wall-clock variability explicit rather than hiding it.

Reproduce by loading each revision's data.py using importlib.util, overriding
HISTORY_DIR to this worktree's etf-dashboard/public/data/history, then calling
one function once to warm it and timing five more calls with perf_counter.
Keep the existing CSV cache behavior; do not clear caches between samples.

Validation: full pytest — 331 passed in 50.66s; Python compilation and
`git diff --check` clean.
