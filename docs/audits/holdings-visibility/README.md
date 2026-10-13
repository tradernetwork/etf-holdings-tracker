# Phone screenshots: before / after

390×844 viewport, live API. **Before** is current main after Art's funnel work
(`6af609d`), **after** is this restoration. The earlier `8512ce1^` baseline was
compared by source inspection, as recorded in the audit findings table.

Full-page website captures expose page order; tables scroll horizontally inside
the viewport instead of hiding columns. Native captures show the actual phone
viewport of its virtualized screen, not a fabricated whole-book render.
The live snapshot during capture was October 12. Browser-only API CORS proxying
was used for local native previews; financial responses came from the live API.

| Screen | Website before | Website after | Native before | Native after |
|---|---|---|---|---|
| MSTY | [Before](before-website-MSTY.png) | [After](after-website-MSTY.png) | [Before](before-app-MSTY.png) | [After](after-app-MSTY.png) |
| ARKK | [Before](before-website-ARKK.png) | [After](after-website-ARKK.png) | [Before](before-app-ARKK.png) | [After](after-app-ARKK.png) |
| AVUV | [Before](before-website-AVUV.png) | [After](after-website-AVUV.png) | [Before](before-app-AVUV.png) | [After](after-app-AVUV.png) |
| TSLA | [Before](before-website-TSLA.png) | [After](after-website-TSLA.png) | [Before](before-app-TSLA.png) | [After](after-app-TSLA.png) |

Wide native evidence (1366×768) is also retained in `/tmp/tt-visible-shots/`.
Positions remains the default tab on MSTY, ARKK and AVUV, with share quantities
and market values present; TSLA holders retain per-fund share counts.
