# Play Store listing, assets and Data safety answers (native app)

Retail copy updated October 14, 2026 for `pro.tickertrace.app`. Optional daily notifications are live. The privacy and Data safety notes below remain relevant.

## 1. Text

**App name** (25/30 characters):

```text
TickerTrace: ETF Holdings
```

**Short description** (75/80 characters):

```text
See what big funds bought and sold. Full holdings, shares and daily alerts.
```

**Full description** (2262/4000 characters):

```text
See what the big funds bought and sold yesterday — the stuff you'd otherwise dig out of spreadsheets. We did the spreadsheet part. You're welcome.

TickerTrace compares the holdings that ETFs publish each day. Look up a fund or a stock and see what changed, how many shares it holds, and how much of its portfolio is in each position.

LOOK INSIDE THE FUNDS
• Browse full portfolios, including stocks, options, cash and Treasury holdings.
• See share counts, share changes, portfolio weights and estimated dollar amounts.
• Compare what a fund added, cut, bought for the first time or sold completely. Switch between daily, weekly and monthly changes.

FOLLOW WHAT YOU CARE ABOUT
• Star funds and stocks for your own Following list. No account needed.
• Turn on an optional daily notification digest for important changes among your follows.
• Look up a stock to see which tracked funds own it, their positions and its recent history.

GO A LITTLE DEEPER
• Find stocks that several fund families started buying around the same time.
• Explore options positions, new options listings and upcoming expiration dates.
• Compare funds designed to pay income, their payouts and how their holdings match their strategy.
• Use a light theme, a dark theme or your phone's setting.

A FEW THINGS TO KNOW
This is daily holdings data, not live trades. Funds can report late. We show the data date and flag old information. A fund catching up after a gap doesn't suddenly count as one huge day of buying or selling.

Price changes alone can make a position look bigger or smaller. Our change calculations account for that. Dollar amounts labelled as estimates are estimates, not trade receipts.

FREE, WITH NO ADS
No ads, no ad SDKs and no analytics libraries in the app. We count anonymous daily totals of fund and stock views and aggregate follower counts to see what's useful. Those counts contain no IP address, device ID or personal identifier. Optional notifications use a separate device registration to deliver your digest. Details: tickertrace.pro/privacy.

You'll also find links to TraderMatrix, a separate trading tool from our network.

TickerTrace reports what funds publish. It is information, not investment advice or a recommendation to buy or sell anything.
```

**Release notes** (241/500 characters):

```text
Full fund portfolios, share counts and changes, stocks and options in one place. Follow the funds and stocks you care about, and turn on an optional daily notification digest. We also made this description sound less like a finance textbook.
```

**Feature-graphic tagline options** (text options, not uploaded artwork):

- Big fund moves. Less spreadsheet digging. (41 characters)
- Your stocks. Their holdings. One place. (39 characters)
- See the shares behind the headlines. (36 characters)

Counts include spaces, punctuation and line breaks inside each copy block. Release notes are a draft for the next release; listing-only publishing does not change release tracks.

Manual publishing: Play Console → app → Grow users → Store presence → Main store listing → English (United States). Paste App name, Short description and Full description into their matching fields, then Save and send for review when prompted. Release notes go with the next release, not in the store-description field.

Category: Finance. Contact: admin@tradermatrix.pro. Website: https://tickertrace.pro. Privacy: https://tickertrace.pro/privacy.

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
| Users can request deletion | Yes, by email to admin@tradermatrix.pro, but note the identifier is anonymous and held by Expo, not by us: we cannot look it up for a user, and Expo's own deletion process applies |
| Personal info, financial info, location, contacts, messages, photos, audio, health, web browsing, app activity, app info and performance (crash/diagnostics) | **Not collected** |
| Advertising ID | Not collected, AD_ID permission removed |
| Account creation | None. Data deletion URL not required |

### Release B (once notifications are live; update the form BEFORE enabling the flag)
Add to Release A:
| Data type | Collected | Purpose | Shared | Optional | Notes |
|---|---|---|---|---|---|
| **Device or other IDs**: push token and random device ID | Yes | App functionality (the daily digest) | No (Expo push service and Google FCM process it as service providers) | **Yes**, off until the user turns it on | stored on our server; 180-day idle expiry |
| **App activity: Other actions**: the list of followed funds/stocks | Yes | App functionality | No | Yes | only sent when notifications are on; stored with the device record |
Deletion: in-app, **Settings > "Clear my follows"** or turning notifications off deletes the server record immediately when the phone is online. We cannot look a device up by name or email (we hold neither), so email requests are answered by pointing to the in-app path; expiry after 180 days without use covers uninstalled apps. "Data is processed ephemerally": no. "Committed to Play Families policy": no. "Independent security review": no.

These are our best reading of Google's categories; Google is the arbiter, and a reviewer may ask to reclassify "Other actions" or the per-install ID. If in doubt, declare more rather than less.

## 4. Privacy policy delta (tickertrace.pro/privacy)

The live policy said the Android app "is the same site in a wrapper", and described analytics (Google Analytics 4, Vercel Analytics) as if they applied everywhere. This PR edits `etf-dashboard/app/privacy/page.tsx` (review before merging; it is a legal page):
- Intro: applies to the site and to the native Android app; where they differ the sections say so. Last updated date set to October 11, 2026.
- "Usage analytics" is scoped to **the website only**.
- New section **The Android app**: no ads/analytics/tracking libraries; follows, theme, notification setting stored on the phone; the update service receives app version, platform, a random per-install identifier and the IP address.
- New section **Notifications (optional)**: off until enabled; registers a random device ID, the Expo push token, a hashed access secret and the follow list; used only for the digest; no name/email/phone/ad ID/location/portfolio; delivered via Expo's push service and Google FCM; unsent digests dropped after 24 h, digest records deleted after 30 days, registrations after 180 days without use (a delivered digest counts as use); delete via Settings ("Clear my follows" or turn notifications off; needs the phone online); one-way token-hash enrollment counter removed shortly after the UTC-day boundary; no deletion by name/email because we hold neither; no backups of our own (provider snapshots may persist deleted rows until they rotate). Every claim is mapped to code in the PR #170 thread.
The policy text is already accurate for Release A (it describes notifications as optional and off); it should go live **before or with** the first store release, and in any case before the notifications flag is turned on.

## October 13 update: first-party aggregate popularity

No analytics/tracking SDK is added. FastAPI keeps UTC daily request totals by
fund/ticker and source (`app`, `mcp`, `api`), never IP/UA/device/install IDs or
individual request records. Website API reads are tagged and excluded. Successful
fund/ticker/stock/options requests count separately; these are not unique users
or guaranteed screen-open counts. Follower reporting reads only SQL grouped totals,
never per-device rows or a join to viewing data. Anonymous totals are pruned to
90 UTC days on background writes. Counters are best-effort and may undercount a
crash, lock contention or overload. Existing infrastructure/access logs and Expo
update/push identifiers are separate from these counters, as the policy describes.

### Exact Play Console edits (owner action before the updated app rollout)

Play Console → **Policy and programs → App content → Data safety → Manage**:

1. Keep **Does your app collect or share any required user data types? → Yes**.
2. Under **App activity**, select **App interactions**. This replaces the earlier
   blanket “app activity not collected” answer for Release A.
3. For **App interactions**: **Collected → Yes; Shared → No; Processed
   ephemerally → No; Required → Yes; Purpose → Analytics**. It is automatic for
   detail requests, with no opt-out, and aggregate totals persist beyond requests.
4. For the existing **App activity → Other actions** (notification follow list),
   keep **Collected → Yes; Shared → No; Optional → Yes; Processed ephemerally →
   No**. Keep **App functionality** and additionally select **Analytics** because
   anonymous grouped follower totals measure popularity. Follows remain optional
   through the notifications opt-in; no per-device analytics is produced.
5. Keep the existing **Device or other IDs** answers for Expo updates and push:
   their purposes remain **App functionality**, not Analytics. Do not apply
   the usage-counter “no identifier” claim to Expo's separate identifiers.
6. Keep **Encrypted in transit → Yes**, existing deletion/notification controls,
   and the privacy URL **https://tickertrace.pro/privacy**. Review, save and submit.

The counters are **not linked to a user/device**. Do not invent an Apple-style
“linked to you” checkbox if this Play form does not offer one; if a linking
question is shown, answer **No for these aggregate interaction counts**. The
existing push/device registration still contains a device identifier for delivery.

This is a conservative declaration: requests reach our server before aggregation,
so we are not relying on Google's exemption for data anonymized *before* leaving
the device. The exact category/purpose mapping above is our implementation-based
interpretation of [Google's official definitions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).
Google defines automatic collection without a universal opt-out as required and
analytics as measuring feature use; service-provider transfers and anonymous
aggregation do not justify saying the existing update/push data is absent.
