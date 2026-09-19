# Whop app — build status

## What shipped

A free TickerTrace app, packaged for Whop. Lives under `whop-app/` in
this repo, deploys independently to Vercel, points at the existing
public FastAPI at `api.tickertrace.pro`. Zero new backend.

Seven routes, all server-rendered:

| Path | What it is |
|------|------------|
| `/` | Redirect to `/discover` |
| `/discover` | Public app-store pitch (no auth) |
| `/experiences/[experienceId]` | Main dashboard, JWT verified. Tabs: Signals / Briefing / Changes / Divergences / Sectors |
| `/experiences/[experienceId]/fund/[ticker]` | Fund detail — provider, AUM, holdings, options book if any, rolls, recent changes |
| `/experiences/[experienceId]/ticker/[ticker]` | Cross-fund detail — every fund holding the ticker, recent activity |
| `/dashboard/[companyId]` | Admin view, gated to admin access level |

## How we got there

Six waves over the session, each one its own commit:

- **wave 0** — scaffold, SPEC, 26-item feature list
- **wave 1** — Whop SDK foundation (`@whop/api` + `@whop/react`), iframe
  layout, lib/api copy from etf-dashboard, frame-ancestors CSP
- **wave 2** — experience view shell, Signals tab, sub-route stubs
- **wave 3** — parallel fan-out, 3 subagents in non-overlapping lanes:
  briefing tab, changes tab with filters, fund detail page
- **wave 4** — parallel fan-out, 2 subagents: ticker detail, divergences
  and sectors tabs
- **wave 5** — discover view, admin dashboard, provisioning doc,
  Patch Notes entry on the main repo's landing page
- **wave 6** — final verify, feature list flip, this doc

## Feature list

24 of 26 features pass. The two that don't:

- **#13** (Fund detail shows option book on ULTY/KQQQ): the *code path*
  is in place — `optionsCount > 0 && optionHoldings.length > 0` gates a
  full Option Book card on the fund page. But we can't verify against
  a live ULTY render without a Whop session that's authenticated, so
  this gets ticked manually after deploy.
- **#22** (Mobile responsive at 375px): every page was written with
  Tailwind responsive utilities and a horizontally-scrollable tab nav,
  but visual viewport testing belongs to a human with a phone, not the
  build script.

Both are confirm-in-prod kinds of checks, not bugs.

## Provisioning

The admin API key in `../.env.whop.txt` is a company-level v2 REST
key. It can read the company's products / experiences / memberships
but cannot create apps or products. So the actual Whop App entity
still needs to be created in the dashboard UI — `PROVISIONING.md` has
the click-by-click. The discovered company id is `biz_wOS4zmZpztAFHR`.

If you mint the real App API Key (`wapi_...`) from
`whop.com/dashboard/developer/apps`, drop it into
`whop-app/.env.local` and the build will be ready to deploy as-is.

## What's left for the human

1. Create the app in the Whop dashboard, copy the three credentials.
2. `cp .env.example .env.local`, paste them in.
3. Deploy `whop-app/` to Vercel. Wire the env vars there too.
4. Set the Vercel URL as the app's Base URL in the dashboard.
5. Install it into the test community and click through Signals → a
   ticker → a fund. Confirm option book on ULTY.
6. Flip status from `hidden` to `live` on the app entry.

## App Store glow-up (2026-09-18, branch `feat/whop-app-glowup`)

Rejected 2026-06-12 for (a) forcing dark theme over the host theme and
(b) lacking CREATOR utility. (a) was already fixed before this pass —
`WhopThemeScript` in `app/layout.tsx` inherits the host's light/dark mode,
and every component uses the shared design tokens (`bg-card`,
`text-muted-foreground`, etc.) so it renders correctly in both. (b) was
partially fixed (the admin-only Broadcast tab existed) but never wired into
the actual admin dashboard, and the app still had thin engagement surfaces
for members. This pass:

1. **Real admin dashboard** (`app/dashboard/[companyId]/page.tsx`) — no
   longer a stub. Resolves the company's installed experienceId via
   `whopSdk.experiences.listExperiences({ companyId, appId, first: 1 })`
   and embeds the *actual* `BroadcastComposer` there (same component +
   server action the in-app Broadcast tab uses — the action re-checks admin
   access server-side regardless of entry point, so there's no new trust
   boundary). Falls back to a plain-language pointer at the in-app tab if
   experience resolution fails for any reason. Added a "how to use this
   with your community" section. No new persistence was added — there was
   nothing safe to add without a storage layer, so no settings were
   invented.
2. **Broadcast upgrade** — `lib/brief.ts` now exposes `topBuys`, `topSells`,
   and `topSignal` alongside the existing brief text. The composer
   (`components/broadcast-composer.tsx`) renders each top buy/sell as a real
   `Link` deep-linking to `/experiences/[experienceId]/ticker/[ticker]`
   (verified against `node_modules/@whop/api`'s `SendNotificationInput` type
   that a push notification carries exactly one `restPath`/tap target, so
   "every signal deep-links" happens in the composer preview; the push
   itself now opens the single top mover's ticker page instead of the
   generic `?tab=signals`, in `app/experiences/[experienceId]/broadcast-action.ts`).
3. **Signal track record** — `components/track-record-card.tsx`, new, reads
   `api.signalPerformance()`. Handles null/zero-sample gracefully.
4. **Today's brief card** — `components/daily-brief-card.tsx`, new. Top buy,
   top sell, biggest streak, each a deep link. Sits above the tab content on
   `app/experiences/[experienceId]/page.tsx`.
5. **TraderMatrix footnote** — `components/trader-matrix-card.tsx`, new,
   reads `api.tradermatrix()`. Deliberately subdued styling (dashed border,
   muted background), a quiet text link, no button, no urgency copy. Renders
   nothing if the handoff payload is unavailable.
6. **Trending tickers row** — `components/trending-tickers.tsx`, new, sits
   directly under the ticker search box, built from today's top 3 buying +
   top 3 selling signals.
7. **Review-risk fixes**:
   - Non-admin hitting `?tab=broadcast` now gets an explicit "admins only"
     message instead of a silent fallback to Signals.
   - The stale `github.com/mphinance/etf-holdings-tracker` link on the
     dashboard now points at `github.com/tradernetwork/etf-holdings-tracker`.
   - `next.config.ts` already had the correct `frame-ancestors` CSP for
     `whop.com`/`*.whop.com` — no change needed there.
   - Every new component uses the existing design-token classes (verified
     against `app/globals.css`'s light *and* dark palettes) and was written
     to hold up at 375px (stacking grids, `flex-wrap`, `overflow-x-auto`
     pill rows).

The 4 new presentational components (track-record-card, daily-brief-card,
trending-tickers, trader-matrix-card) were drafted by
`inclusionai/ling-3.0-flash` via OpenRouter per house convention for
well-scoped single-file work, then reviewed and placed as-is (all four
needed no fixes beyond what the model produced). Combined cost: **$0.00206**.

### What was skipped and why

- **Share-to-community-feed button per signal** (from the ideas doc) —
  skipped. Couldn't confirm a community-feed-post mutation in the installed
  `@whop/api` types; not worth guessing at review time.
- **Creator activity dashboard** (member opens, most-viewed tab) — skipped.
  No engagement/analytics endpoints in the installed SDK, and this app has
  no database to log its own usage into.
- **Autocomplete on ticker search** — skipped, lower priority than the
  above 7 items and not part of the rejection reasons; can be a follow-up.
- **Persisted dashboard settings** (tab display name, banner text) — skipped
  per the brief: no persistence layer exists in this app by design, and
  adding one wasn't in scope for a resubmission pass.

### Verification

- `npm run typecheck` — clean, zero errors.
- `npm run lint` — **could not run**; this predates this change; there is
  no `eslint.config.*` anywhere in the repo (confirmed absent on
  `origin/main` too) despite `eslint`/`eslint-config-next` being installed.
  A minimal flat config was tried and hit an unrelated `eslint-plugin-react`
  circular-JSON crash under this exact dependency combination (eslint
  9.39.4 + eslint-config-next 16.1.6) — not something to chase mid-glow-up.
  Left as a pre-existing gap; typecheck + build were the effective gates.
- `npm run build` (with dummy Whop env vars) — succeeds, same 7 routes as
  before, zero TS errors.
- `npm run dev` smoke test: `/` → 307, `/discover` → 200 with real content,
  `/experiences/exp_test` → 200 rendering "Open this inside Whop" (JWT gate
  intact), `/dashboard/biz_test` → 200 rendering the same notice (admin gate
  intact). No iframe/auth-dependent paths were exercised beyond that, per
  the brief.

### Resubmission checklist — remaining human steps

1. Review this diff and merge `feat/whop-app-glowup` (this session did not
   push, merge, or deploy anything).
2. Deploy `whop-app/` to Vercel per the existing README steps, if not
   already deployed at the URL Whop points to.
3. In the Whop dashboard for `app_AQjwzqQarLrvSQ`, confirm the
   `notification:create` scope is enabled (required for Broadcast; see
   `PROVISIONING.md` — this was flagged before this session and may still
   be unchecked).
4. Optional, for the ticker deep-link on the push notification to actually
   land on the ticker page instead of the app's default view: set the
   experience view path in the dashboard to
   `/experiences/[experienceId][restPath]` (also documented in
   `PROVISIONING.md`). Works fine without this too, it just opens the
   default view instead.
5. Install into a test community as both an admin and a non-admin member
   and click through: confirm the admin dashboard shows the live composer
   and sends correctly, confirm a non-admin visiting `?tab=broadcast`
   directly sees the "admins only" message instead of a silent redirect,
   confirm the new cards (today's brief, trending tickers, track record,
   TraderMatrix footnote) render and look right in both the community's
   light and dark theme, and at a phone width.
6. Resubmit for App Store review once the above is confirmed.

## Doesn't touch

The scraper, the FastAPI, the MCP server, the main public dashboard,
and the rest of the existing repo are untouched. Only file outside
`whop-app/` that changed is `etf-dashboard/app/page.tsx` — one new
Patch Notes entry announcing the Whop app shipped.

## Build proof

```
> tickertrace-whop@0.1.0 build
> next build

? Compiled successfully in 16.4s
  Running TypeScript ...
? Generating static pages using 3 workers (4/4) in 416.2ms

Route (app)
+- /                              (static, redirect)
+- /_not-found                    (static)
+- /dashboard/[companyId]          (dynamic)
+- /discover                     (static)
+- /experiences/[experienceId]     (dynamic)
+- /experiences/[experienceId]/fund/[ticker]    (dynamic)
+- /experiences/[experienceId]/ticker/[ticker]  (dynamic)
```

Local dev smoke at `http://localhost:3001`:
- `GET /` returns 307 to `/discover`
- `GET /discover` returns 200
- `GET /experiences/exp_test` returns 200 with the "open inside Whop" empty state
