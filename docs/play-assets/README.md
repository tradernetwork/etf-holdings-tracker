# Play Store screenshots of the native app

Captured 2026-10-14 from the native app's web export (`mobile/`, current `main`) against the **live production API** (`https://api.tickertrace.pro`, data as of Oct 14, deltas "vs Tue Oct 13"). No invented data and nothing personal on screen (no device ids, no debug overlays); the Following tab shows the public example follows MSTY, AVUV, KYLD, TSLA and NVDA. Theme: **Paper** (light), used consistently in both sets.

Play requirements (checked against support.google.com/googleplay/android-developer/answer/9866151): JPEG or 24-bit PNG **without alpha**; shortest side at least 320 px, longest at most 3840 px, long side at most 2x the short side; for phones and large screens 16:9 landscape / 9:16 portrait, at least four shots, up to eight per device type; the recommendation for screenshot-driven placement is 1920x1080 landscape and 1080x1920 portrait at minimum. All files here are RGB PNGs: `chromebook/` is **1920x1080** and `phone/` is **1080x1920**.

| # | File | Shows |
|---|---|---|
| 1 | `01-today` | The daily evidence brief: the top allocation move with its countercase, "also worth a look", the funds-tracked line and the "Δ vs Tue Oct 13" period label |
| 2 | `02-fund-with-options` | MSTY (an option-income fund): brokerage-style positions, the synthetic MSTR stock with coverage / upside / DTE, and its written and long option legs with contracts, price, value and % of fund |
| 3 | `03-fund-stocks` | AVUV (an equity fund, no option columns): shares, $ value, % of fund and share / weight change, headed "Δ shares and weight · vs Tue Oct 13" |
| 4 | `04-ticker-evidence` | A ticker (TSLA): "Opposite moves", the funds that opened or added with their active weight change, weights, shares in and out, and the estimated flow |
| 5 | `05-changes` | Changes across funds: the day's stock-position changes with the period label and the Active Equity / Option-Income / All and Day / 7 days / 30 days controls (Chromebook: By ticker view with net moves) |
| 6 | `06-explore-search` | Explore: ticker or fund search narrowing the fund directory (here "YM": YMAX and YMAG), the AUM / Holdings / A-Z sorts and the combined-AUM headline |
| 7 | `07-following` | Following: five followed funds and tickers and what each did in the latest file, only when the move is meaningful |
| 8 | `08-holdings` | The full holdings browser: every position row across all tracked funds, type filters, 12 sort columns and CSV export |

## Regenerating
Both sets come from the web export (`npx expo export --platform web`, API URL pointing at the live API through a CORS pass-through), driven with Playwright: phone = 360x640 CSS px at 3x, Chromebook = 1280x720 CSS px at 1.5x (the app's wide layout: a left navigation rail on the tabs and a centred reading column on detail screens), Paper theme, the five example follows seeded into local storage, notification prompt dismissed. The API rate-limits (30 to 60 requests a minute), so capture screens a few at a time and check each one loaded its full data (a fund screen that falls back to the plain book is missing its income view).

A hosted copy with thumbnails and zips lives at https://api.tickertrace.pro/previews/play-assets/.
