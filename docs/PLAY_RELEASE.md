# Play release runbook: native app replaces the Chrome TWA on `pro.tickertrace.app`

Prepared 2026-10-11. **Nothing here has been submitted, uploaded to Play, or applied to EAS.** The two EAS scripts below were developed against EAS's read-only queries (their dry-run mode); no mutation has been run. Companion: `docs/PLAY_STORE_LISTING.md` (copy, graphics, Data safety, privacy delta) and `docs/NOTIFICATIONS_GO_LIVE.md`.

> **Status, Oct 12 2026: DONE.**
> - The Play **upload keystore** is in EAS as the default Android credential `play-upload-key` (SHA-256 `83:78:2F…A3:A9`, verified).
> - The **versionCode floor is set to 100**: the next production build is **101**.
> - The account also holds one extra, **unattached** copy of the same keystore from the first attempt (the fingerprint check below wrongly refused a genuine match, see section 2). It is safe to delete later in expo.dev → Credentials. Do not delete the one attached as `play-upload-key`.
> - The fingerprint bug is fixed: EAS returns lower-case hex without colons, openssl prints upper-case with colons; both sides are now normalised (`scripts/play/fingerprint.cjs`, tested in `mobile/__tests__/play-scripts.test.ts`). A re-run of the dry run now reports "Already uploaded … default=true. Nothing to do."

## 0. Findings that change the plan

1. **versionCode.** EAS's remote counter for this app is **3** (the v3 preview APK). The TWA's versionCode on Play is unknown from here. Play rejects any upload whose versionCode is not strictly greater than every versionCode ever uploaded to the listing, so the first production build could be rejected, or worse, succeed only on a track you did not intend. **Read the highest versionCode in Play Console (Release > App bundle explorer) and raise EAS's counter above it** with `scripts/play/set-version-floor.mjs` (section 2). `eas build:version:get -p android -e production` only reads EAS's own counter; it cannot see Play.
2. **Upload keystore to EAS: yes, it can be scripted.** EAS exposes GraphQL mutations (`createAndroidKeystore`, `createAndroidAppCredentials`, `createAndroidAppBuildCredentials`). `scripts/play/upload-keystore-to-eas.mjs` does all three, verifies the keystore's SHA-256 against the Play upload-key fingerprint (`83:78:2F...A3:A9`, verified to match) before touching anything, defaults to a read-only dry run, and prints no secret. The same API has `createFcmV1Credential`, so the **Firebase FCM V1 key for push can be uploaded with a script too** (`scripts/play/upload-fcm-key-to-eas.mjs`), which shortens the notifications go-live steps; the Firebase project and key themselves still need the user's Google account.
3. **The EAS account currently has no Android credentials** (`androidAppCredentials = []`), confirmed by the dry run. Preview builds used `credentialsSource: local`.
4. **A production-blocking API slowness:** `GET /api/v1/stock/{ticker}` takes 20 s+ on production (NVDA did not answer within 60 s). The ticker screen waits on it. Fix it (reported separately: per-row `get_fund_aum` stat calls and a thrashing CSV cache) **before** releasing to a wider audience than the internal track.
5. The launcher icon is 512 px (Expo recommends a 1024 px master). It builds fine; a 1024 px master is a polish item.

## 1. Production credentials (hosted by EAS)

Needs: `~/secrets/tickertrace-play/{expo-token,signing.keystore,signing-key-info.txt}` on the machine you run it from. Run from `mobile/`:

```bash
node scripts/play/upload-keystore-to-eas.mjs            # DRY RUN: verifies fingerprint, shows what EAS holds, changes nothing
node scripts/play/upload-keystore-to-eas.mjs --apply    # creates the keystore, the app credentials row and the default build credentials
```
Success prints `VERIFIED: EAS now holds the Play upload key as the default Android credential.` and the script is idempotent (it stops if EAS already has this exact certificate; fingerprints are compared with colons, case and spacing ignored). Afterwards `eas credentials -p android` (production) shows keystore "play-upload-key". Never commit keystores or `credentials.json`.

If you would rather do it by hand: `npx eas-cli credentials -p android`, choose **production**, **Keystore: Manage everything needed to build your project**, **Upload a keystore** (from `~/secrets/tickertrace-play/signing.keystore`; the passwords and alias are in `signing-key-info.txt`), then confirm the SHA-256 shown starts `83:78:2F` and ends `A3:A9`.

Play App Signing: the listing already uses it (the upload key we hold is not the app signing key), so signing with this upload key is exactly what Play expects for an update.

## 2. Versioning

`eas.json` already has `"appVersionSource": "remote"` and `autoIncrement: true` on `production`: EAS increments `versionCode` each build from its remote counter.

```bash
# 1. In Play Console find the highest versionCode ever uploaded (say 57).
node scripts/play/set-version-floor.mjs 57             # dry run: "next production build will be versionCode 58"
node scripts/play/set-version-floor.mjs 57 --apply     # raises the EAS counter (it never lowers it)
npx eas-cli build:version:get -p android -e production # confirm: 57; the next build becomes 58
```
`versionName` comes from `version` in `app.config.ts`, now **`1.0.0`**. Because `runtimeVersion` is `appVersion`, **the version string is also the OTA runtime**: the 0.1.0 preview APKs and the 1.0.0 production build are separate runtimes, so a preview OTA can never reach production users. Publish OTAs per runtime (`eas update --channel production` targets 1.0.0 builds) and never let an OTA target a runtime you do not mean to. `versionCode` is managed remotely (`autoIncrement`).

## 3. `eas.json` production profile (reviewed and updated in this PR)

| Setting | Value | Why |
|---|---|---|
| `android.buildType` | `app-bundle` | Play requires an AAB (previews stay APK for sideloading) |
| `channel` | `production` | OTAs for store users only ever come from this channel |
| `credentialsSource` | default (remote) | uses the hosted upload key from section 1 |
| `environment` | `production` | use the EAS production environment's variables |
| `env.EXPO_PUBLIC_API_URL` | `https://api.tickertrace.pro` | pinned so a build never depends on EAS variables being filled in |
| `env.EXPO_PUBLIC_NOTIFICATIONS_BACKEND` | `"0"` | notifications client flag explicitly OFF (code checks `=== "1"`) |
| `autoIncrement` | `true` | with `appVersionSource: remote` |
| `submit.production.android` | `track: internal`, `releaseStatus: completed` | first upload goes to **internal testing**, never straight to production |

Also set the same variables in the EAS production **environment**, because `eas update --environment production` (required on SDK 57) ignores `eas.json` env and `.env`:
```bash
npx eas-cli env:set production --name EXPO_PUBLIC_API_URL --value https://api.tickertrace.pro --visibility plaintext --non-interactive
npx eas-cli env:set production --name EXPO_PUBLIC_NOTIFICATIONS_BACKEND --value 0 --visibility plaintext --non-interactive
```
(`EXPO_PUBLIC_*` are inlined into the public bundle; never put a secret in one.) `eas submit` additionally needs a **Google Play service-account JSON** configured in EAS; we have none, so the first upload is **manual in Play Console**; do not add automatic submission until the track flow below has been done once by hand.

## 4. Build (no upload)

```bash
cd mobile
npx eas-cli build --profile production --platform android      # builds an AAB signed with the hosted upload key
```
Download the `.aab` from the EAS build page. Optionally inspect it: `bundletool`/Play's pre-launch report will show target SDK, permissions (expect `POST_NOTIFICATIONS` from expo-notifications and **no** `AD_ID`).

## 5. Release path

**Step 1: Internal testing (up to 100 testers, no review wait).** Play Console > Testing > Internal testing > Create release > upload the AAB > release notes (see listing doc) > roll out. Add your Google account to the testers list, install from the opt-in link, and check: first launch (no crash), Today loads, a ticker opens (see finding 4), Following works offline, Settings theme, **Clear my follows**, and that the build is not the TWA (no Chrome "tickertrace.pro sign-in status" disclosure). Also confirm the update path: install over the existing TWA on a test phone (same package, upgrade in place; the TWA's data is not carried over).

**Step 2: Closed testing (alpha), only if Play requires it.** New *personal* developer accounts must run a closed test with 12+ testers for 14 days before production access; an established or organization account with an existing production listing is normally exempt. Check Play Console > Dashboard > "Release your app" for the exact requirement before assuming either way.

**Step 3: Store listing and forms** (all in `docs/PLAY_STORE_LISTING.md`): short/full description, 8 phone screenshots, feature graphic, icon, content rating (IARC), target audience 18+, **Data safety (Release A answers)**, privacy policy URL, ads declaration (no ads), news/health/finance declarations (finance: not a trading or loan app; informational). Merge the privacy-policy change and let it deploy first.

**Step 4: Production with a staged rollout.** Promote the tested release (or upload the same AAB) to Production at **5 %** (the TWA's users get the update automatically as their phones update). Watch Play Console Android vitals (crash and ANR rate) and the Pre-launch report for 24 h, then 20 %, 50 %, 100 % at roughly daily steps. Halting is one click ("Halt rollout").

**Step 5: Notifications later.** They ship through the existing binary only if it already contains Firebase: see `docs/NOTIFICATIONS_GO_LIVE.md`. That needs a **new** AAB with `google-services.json` (version bump, new versionCode), updated Data safety (Release B), and the policy already live. Do this as a separate release, not bundled with the first store release.

## 6. Rollback

- **JavaScript-only problem:** `npx eas-cli update:rollback --branch production` (or publish a fixed update to the `production` channel with `--environment production`). Users get it on the next cold starts. No Play action needed.
- **Native problem:** Play cannot revert to a lower versionCode. Options: halt the rollout (stops further users getting it, existing installs keep it), then ship a fixed build with a **higher** versionCode (EAS autoIncrement handles it). To go back to the old TWA you would have to rebuild that TWA with a versionCode above the native app's; keep the TWA project's signing/build files until the native app is at 100 % and stable.
- **Staged rollout bad signal:** halt at the current percentage; do not increase until fixed.

## 7. After the TWA is fully replaced

- Keep `etf-dashboard/public/.well-known/assetlinks.json` (it lists two cert fingerprints for `pro.tickertrace.app`) **until** the native app is at 100 % rollout and has been stable for about two weeks and Play Console shows no meaningful share of TWA installs. Then delete the file in a normal PR. Removing it earlier makes the old TWA fall back to a Custom Tab with a visible URL bar for users who have not updated.
- The native app does not use Digital Asset Links (it has a custom `tickertrace://` scheme only). If https deep links are wanted later, add an intent filter with `autoVerify` and re-add an assetlinks entry for the **Play app signing** certificate.
- Update `mobile/README.md` "Release blockers" and delete this section's TWA-specific caveats once done.

## 8. Checklist

- [x] `upload-keystore-to-eas.mjs` dry run reviewed, then `--apply` (done Oct 12; default `play-upload-key`)
- [x] Highest Play versionCode read from Play Console; `set-version-floor.mjs` run (floor 100, next build 101; done Oct 12)
- [ ] EAS production environment variables set (section 3); version bumped to 1.0.0 (section 2)
- [ ] `/api/v1/stock/{ticker}` slowness fixed or consciously accepted for internal testing only
- [ ] Privacy policy change merged and live; Data safety (Release A) entered
- [ ] AAB built; uploaded to **Internal** testing by hand; install-over-TWA test passes
- [ ] Listing copy, 8 screenshots, feature graphic, icon, ratings, audience, ads declaration complete
- [ ] Production staged rollout 5 % > 20 % > 50 % > 100 % with vitals checked between steps
- [ ] assetlinks.json removed only after the TWA is gone (section 7)

## 9. CI/CD (GitHub Actions)

Ported from `tradernetwork/vero` (`build.yml`, `ota-update.yml`, `eas-ops.yml`). All three need the **`EXPO_TOKEN`** repo secret (a robot token for the `tradernetwork` Expo account). Production signing uses the **EAS-hosted** upload keystore (`play-upload-key`) and `versionCode` is remote with `autoIncrement`, so nothing about credentials or version codes lives in GitHub.

| Workflow | Trigger | What it does |
|---|---|---|
| `mobile-release.yml` | push a tag `mobile-v*`, or run it by hand with a profile | `tsc` + jest gate, then `eas build -p android --profile production --non-interactive --no-wait --auto-submit`: EAS builds and **submits to the Play internal track** when the build finishes (the job ends in about a minute). One run at a time (`concurrency`). Non-production profiles build without submitting. |
| `ota-update.yml` | run by hand: message + channel (`preview` or `production`) | `tsc` + jest gate, then `eas update --channel X --environment X --platform android --clear-cache` (SDK 57 requires `--environment`; the EAS environment of that name must exist). |
| `eas-ops.yml` | run by hand: `status`, `submit-android` or `release-android-production` | `status` lists builds/updates/channel and whether a Play submit key exists. `submit-android` submits the newest **finished production-profile** build (by id) to the internal track. `release-android-production` builds this ref and submits that build to the **production** track with the `production-release` submit profile (Google review still applies). |

**Release an app build:** make sure `version` in `mobile/app.config.ts` is what you want (it is also the OTA runtime), then
```bash
git tag mobile-v1.0.1 && git push origin mobile-v1.0.1
```
The tag is only a trigger: the build uses the `app.config.ts` version, and the workflow warns if the tag disagrees. Watch the build on expo.dev; the submit to the internal track happens automatically after it. Promote internal → production in Play Console, or run `eas-ops` → `release-android-production`.

**Ship a JS-only fix (OTA):** Actions → *OTA update (Android)* → Run workflow → pick the channel and a message. It reaches installs on the **same runtime** (the `app.config.ts` version) at their next cold launch. Native code, plugins or a version change need a new build instead. Note the preview APKs from before 1.0.0 are on runtime 0.1.0 and no longer receive OTAs from `main`; a preview OTA now targets runtime 1.0.0 builds.

**One-time step: the Google Play service-account key goes to EAS, not GitHub.** Without it, `eas submit` and `--auto-submit` cannot publish, so every submitting path first runs `scripts/play/check-submit-key.mjs`, which fails **before the build is queued** with: *"No Google Play service-account key on EAS for pro.tickertrace.app … see docs/PLAY_RELEASE.md, section CI/CD"*. To create the key: Play Console → Setup → API access → link a Google Cloud project → create a service account, grant it release permissions on the app, create a JSON key. Then, from `mobile/`:
```bash
node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json          # dry run
node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json --apply
```
It prints only the service account's `client_email` and key id (never the private key), is idempotent, and attaches the key as the app's submission key via the GraphQL mutations `createGoogleServiceAccountKey` and `setGoogleServiceAccountKeyForSubmissions`. Check it with `node scripts/play/check-submit-key.mjs` or the `eas-ops` → `status` action.

`eas.json` submit profiles: `production` (track `internal`, the default for every build) and `production-release` (track `production`, used only by `eas-ops` → `release-android-production`).
