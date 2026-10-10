# TickerTrace mobile (Expo)

Native Android app that replaces the Chrome TWA wrapping tickertrace.pro. **Shell only**: the
information architecture is still being designed, so the three tabs (Today / Following / Explore) are
placeholders and only *Today* is real (top buys/sells from `/api/v1/signals`, with the data `asOfDate`
and a count of funds not yet updated).

- Expo SDK 57 (current stable), React Native 0.86, expo-router 57, TypeScript strict. Package: `pro.tickertrace.app`.
- Data: `lib/api.ts` (typed client, retry/backoff) + `lib/queries.ts` (TanStack Query).
- Theme tokens: `lib/theme.ts`, mirrored from `etf-dashboard/app/globals.css`.

## Run

```bash
cd mobile
npm ci
npx expo start          # scan the QR with Expo Go, or press `a` with an emulator attached
npx expo start --dev-client   # once you have a development build (eas build --profile development)
npm run typecheck       # tsc --noEmit
npm run doctor          # expo-doctor
```

Needs Node >= 22. `EXPO_PUBLIC_API_URL` overrides the API base (default `https://api.tickertrace.pro`).

### API types

`lib/generated/api-types.ts` is generated from the live spec (`npm run gen:api`) and is used to
restrict `lib/api.ts` to routes that exist. The spec types response *bodies* as plain objects (FastAPI
handlers return dicts), so body shapes are hand-written in `lib/types.ts`. Re-run `gen:api` when the API changes.

## Decisions

- **Orientation: unlocked.** Data tables are far better in landscape; tablets get the same app. Revisit with real screens.
- **Dark only** (`userInterfaceStyle: dark`), matching the dashboard.
- **React Query** over plain hooks: the same payloads will be shared by several tabs, and cache + dedupe +
  pull-to-refresh state come for free. The API client does its own retry, so React Query's is off.
- **Not included yet**: auth (the API is open), offline write queue, charts (vero's Skia chart), push, analytics.
  No ad SDKs, ever (see `.claude/agents/funnel-guard.md`); the AD_ID permission is blocked in `app.config.ts`.

## Release blockers (nothing here can ship until these exist)

1. **Play upload keystore for `pro.tickertrace.app`**: the existing Play listing is signed by whoever uploaded the TWA. The owner must locate that upload key (or request an upload-key reset in Play Console) and give it to EAS (`eas credentials`).
2. **Expo project**: run `eas init` as the owner to create the project; then set `extra.eas.projectId` in `app.config.ts`, and add `expo-updates` + `updates.url` if OTA updates are wanted (see the TODOs there). Not done in this PR on purpose.
3. **`EXPO_TOKEN`** GitHub repo secret, for the manual EAS build workflow (`mobile-build.yml`, `workflow_dispatch` only). That workflow and the `mobile-check` CI job are not in the shell PR; they need a token with the `workflow` scope to push.
4. **Google Play service account** JSON (Play Console API access) configured in EAS for `eas submit`. Not wired into CI; submission is manual for now.
5. **Icon assets**: `assets/icon.png` is the dashboard's 512px icon (Play wants a 512px store icon; Expo recommends 1024px for the app icon). Provide a 1024px master and proper adaptive foreground/monochrome layers.
6. After cutover, `assetlinks.json` (Digital Asset Links for the TWA) is no longer needed and can be removed from the dashboard.

## Agent skills

`.claude/skills/` (repo root) has the vendored Expo skills (MIT, see `EXPO_SKILLS_NOTICE.md`); `AGENTS.md` here is the Expo template's guidance.
