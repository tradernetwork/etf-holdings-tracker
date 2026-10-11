# Play Store listing, assets and Data safety answers (native app)

Prepared 2026-10-11 for listing `pro.tickertrace.app`, which currently serves the Chrome TWA. Nothing here has been entered in Play Console. Copy is in Sam's voice: plain, a little dry, honest about what the data is.

> **Listing vs. what ships.** Notifications are built but their backend and client flags are OFF (see `docs/NOTIFICATIONS_GO_LIVE.md`). The first store release therefore must **not** advertise push. Use the main copy below; swap in the "when notifications are live" lines only after they are.

## 1. Text

**App name** (30 max): `TickerTrace: ETF Fund Moves` (27)

**Short description** (80 max, 77): 
> What the big ETF funds bought and sold, from their daily disclosures. No ads.

**Full description** (4000 max, about 2,300):

> TickerTrace shows what big institutional ETFs actually did with their holdings, straight from the daily disclosures the funds publish. No hype, no account, no ads.
>
> Every trading day we compare each fund's holdings with the day before, strip out price drift and stock splits, and show the real changes: who bought, who sold, how much, and whether unrelated fund families moved the same way.
>
> WHAT YOU GET
> • Today: the day's biggest moves across 98 tracked funds from 13 providers (ARK, Avantis, YieldMax, Roundhill, Amplify and more), in percentage points of the fund's book.
> • Following: star the funds and stocks you care about and see their significant moves in one place.
> • Stocks: who holds a stock, who is adding, who is trimming, plus a 30-session history.
> • Funds: full portfolios with option positions, cash and Treasuries, the way a brokerage shows them.
> • Options: contract-level activity, newly listed options from CBOE, and the Monday/Wednesday/Friday expiration calendar.
> • Effectiveness: how well each option-income ETF executes its stated strategy, scored side by side.
> • Consensus: stocks that several unrelated funds opened within days of each other.
> • A dark look, a light look, or follow your phone.
>
> HONEST ABOUT THE DATA
> Funds publish holdings once a day, so this is a disclosure feed, not a live trade feed. When a fund's data is late or old we say so instead of guessing, and we never present a multi-week catch-up as one day of trading. Dollar sizes marked "est." are estimates (a position's weight times the fund's size).
>
> NO ACCOUNT, NO ADS, NO TRACKING
> Your follows live on your phone. There are no ads, no ad SDKs and no analytics libraries in the app. TickerTrace is free. One link in the app goes to TraderMatrix, a trading tool from our network, and it is labelled as a referral link.
>
> TickerTrace reports what funds disclose. It is information, not investment advice, and not a recommendation to buy or sell anything.

**When notifications are live, add** (after "Following"): `• Daily digest (optional): one notification a day if the funds and stocks you follow made significant moves. Off until you turn it on.` and change the privacy line to mention the optional notification registry (section 4).

**Category:** Finance. **Tags/keywords:** ETF, funds, holdings, fund disclosures, options, ARK, YieldMax, Avantis, portfolio tracker. **Contact email:** admin@tradermatrix.pro. **Website:** https://tickertrace.pro. **Privacy policy URL:** https://tickertrace.pro/privacy (updated in this PR, see section 4). **Content rating:** answer the IARC questionnaire truthfully: no violence, no user-generated content shared with others, no purchases, no ads; finance information only. **Target audience:** 18+ (not for children).

**Release notes (first release, 500 max):**
> TickerTrace is now a native app. Today's biggest fund moves, your follows, stocks, full fund portfolios with options, CBOE listings and the expiration calendar, and an effectiveness scoreboard for option-income ETFs. No ads, no account.

## 2. Graphics (all required assets exist in this PR)

| Asset | Spec | File |
|---|---|---|
| App icon | 512 x 512 PNG, 32-bit | `store-assets/android/icon-512.png` (identical to `mobile/assets/icon.png`) |
| Feature graphic | 1024 x 500 PNG | `store-assets/android/v2/feature-graphic.png` (new tagline: "Follow what the big funds are buying and selling.") |
| Phone screenshots | 2 to 8, 16:9 to 9:16, min 320 px, 1080 x 1920 here | `store-assets/android/v2/terminal/*.png` (dark) and `.../paper/*.png` (light), 8 each |
| Tablet screenshots | optional (7"/10") | none; the app has `supportsTablet`, add later if wanted |

Screens (in listing order): 1 Today, 2 Today in full (signals), 3 Stock (NVDA), 4 Fund (ARKK), 5 Following (NVDA, TSLA, ARKK, MSTY followed), 6 Options, 7 Effectiveness, 8 Explore. Pick one theme for the primary set (Terminal reads best on a dark feature graphic); upload the other set as a localized/alternate set only if you want it. They are rendered from the app's **web export** at 360x640 @3x (`store-assets/android/v2/phones-v2.mjs`), so they are pixel-faithful to the layout but come from react-native-web, not an emulator. If Play review wants emulator captures, retake the same eight on a Pixel emulator after the first internal build.

Notes on the data in the screenshots: the date shown is the data date (2026-10-09), the follows are a demo list, and the ARKK card honestly shows an older-disclosure notice (ARK's data was stale until the fix); retake after the next scrape if you prefer fresh-looking cards. Screenshots must not show anything false, and none does.

## 3. Data safety form (Play Console > App content > Data safety)

**What the shipped code does (verified):** `mobile/package.json` has no analytics, crash-reporting, advertising or attribution SDK; the only network peers are our API (`api.tickertrace.pro`) and Expo's update service (`u.expo.dev`) via `expo-updates`. `expo-updates` (SDK 57) sends `Expo-Platform`, `Expo-Runtime-Version`, the current update ID and a random per-install `EAS-Client-ID` header (checked in `FileDownloader.kt`), plus the request's IP address. The AD_ID permission is blocked in `app.config.ts`. Follows, theme, category and notification state are in AsyncStorage on the phone; the notification device secret, once notifications exist, is in SecureStore.

### Release A (notifications OFF, the first store release)
| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | **Yes** (see next row; "No data collected" would be inaccurate because of the update service) |
| Data collected | **Device or other IDs** (the random per-install update identifier, processed by Expo as our service provider). Nothing else. |
| Purpose | App functionality (delivering app updates) |
| Collected/shared? | Collected: yes. Shared: **no** (transfer to a service provider processing on our behalf is not "sharing" under Google's definition) |
| Optional? | No (required for updates to work) |
| Encrypted in transit | Yes (HTTPS) |
| Users can request deletion | Yes: email admin@tradermatrix.pro (the identifier is anonymous and held by Expo, not by us) |
| Personal info, financial info, location, contacts, messages, photos, audio, health, web browsing, app activity, app info and performance (crash/diagnostics) | **Not collected** |
| Advertising ID | Not collected, AD_ID permission removed |
| Account creation | None. Data deletion URL not required |

### Release B (once notifications are live; update the form BEFORE enabling the flag)
Add to Release A:
| Data type | Collected | Purpose | Shared | Optional | Notes |
|---|---|---|---|---|---|
| **Device or other IDs**: push token and random device ID | Yes | App functionality (the daily digest) | No (Expo push service and Google FCM process it as service providers) | **Yes**, off until the user turns it on | stored on our server; 180-day idle expiry |
| **App activity: Other actions**: the list of followed funds/stocks | Yes | App functionality | No | Yes | only sent when notifications are on; stored with the device record |
Deletion: in-app, **Settings > "Clear my follows"** or turning notifications off deletes the server record immediately; also by email. "Data is processed ephemerally": no. "Committed to Play Families policy": no. "Independent security review": no.

These are our best reading of Google's categories; Google is the arbiter, and a reviewer may ask to reclassify "Other actions" or the per-install ID. If in doubt, declare more rather than less.

## 4. Privacy policy delta (tickertrace.pro/privacy)

The live policy said the Android app "is the same site in a wrapper", and described analytics (Google Analytics 4, Vercel Analytics) as if they applied everywhere. This PR edits `etf-dashboard/app/privacy/page.tsx` (review before merging; it is a legal page):
- Intro: applies to the site and to the native Android app; where they differ the sections say so. Last updated date set to October 11, 2026.
- "Usage analytics" is scoped to **the website only**.
- New section **The Android app**: no ads/analytics/tracking libraries; follows, theme, notification setting stored on the phone; the update service receives app version, platform, a random per-install identifier and the IP address.
- New section **Notifications (optional)**: off until enabled; registers a random device ID, the Expo push token, a hashed access secret and the follow list; used only for the digest; no name/email/phone/ad ID/location/portfolio; delivered via Expo's push service and Google FCM; unsent digests expire after 24 h, sent records deleted after 30 days, idle registrations after 180 days; delete via Settings ("Clear my follows" or turn notifications off) or by email; anonymous per-token enrollment counter until the UTC-day boundary; backups rotated within 30 days.
The policy text is already accurate for Release A (it describes notifications as optional and off); it should go live **before or with** the first store release, and in any case before the notifications flag is turned on.
