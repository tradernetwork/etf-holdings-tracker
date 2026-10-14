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
`versionName` comes from `version` in `app.config.ts`, now **`1.0.1`** (bumped with the ChromeOS manifest change and the new icons, which together changed the native fingerprint). Because `runtimeVersion` is `appVersion`, **the version string is also the OTA runtime**: the 0.1.0 preview APKs and the 1.0.0 production build are separate runtimes, so a preview OTA can never reach production users. Publish OTAs per runtime (`eas update --channel production` targets 1.0.0 builds) and never let an OTA target a runtime you do not mean to. `versionCode` is managed remotely (`autoIncrement`).

## 3. `eas.json` production profile (reviewed and updated in this PR)

| Setting | Value | Why |
|---|---|---|
| `android.buildType` | `app-bundle` | Play requires an AAB (previews stay APK for sideloading) |
| `channel` | `production` | OTAs for store users only ever come from this channel |
| `credentialsSource` | default (remote) | uses the hosted upload key from section 1 |
| `environment` | `production` | use the EAS production environment's variables |
| `env.EXPO_PUBLIC_API_URL` | `https://api.tickertrace.pro` | pinned so a build never depends on EAS variables being filled in |
| `env.EXPO_PUBLIC_NOTIFICATIONS_BACKEND` | `"1"` | notifications client flag ON since the go-live of 2026-10-13 (code checks `=== "1"`); the same variable is set to `1` in the EAS production environment so OTAs do not flip it off |
| `autoIncrement` | `true` | with `appVersionSource: remote` |
| `submit.production.android` | `track: production`, `releaseStatus: completed` | **decision 2026-10-13:** store builds go straight to Play **production** (the old TWA was live; "why would we have broken stuff out there"). Google review applies to each one. `submit.internal` is the opt-in internal-track profile |

Also set the same variables in the EAS production **environment**, because `eas update --environment production` (required on SDK 57) ignores `eas.json` env and `.env`:
```bash
npx eas-cli env:set production --name EXPO_PUBLIC_API_URL --value https://api.tickertrace.pro --visibility plaintext --non-interactive
npx eas-cli env:set production --name EXPO_PUBLIC_NOTIFICATIONS_BACKEND --value 1 --visibility plaintext --non-interactive
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
- [ ] `/api/v1/stock/{ticker}` slowness fixed or consciously accepted (store builds now go to production)
- [ ] Privacy policy change merged and live; Data safety (Release A) entered
- [ ] AAB built; uploaded to **Internal** testing by hand; install-over-TWA test passes
- [ ] Listing copy, 8 screenshots, feature graphic, icon, ratings, audience, ads declaration complete
- [ ] Production staged rollout 5 % > 20 % > 50 % > 100 % with vitals checked between steps
- [ ] Chromebook check done (section 8a)
- [ ] assetlinks.json removed only after the TWA is gone (section 7)

## 8a. Chromebooks (ChromeOS)

ChromeOS runs the Play build of the app; no separate artifact. `plugins/with-chromeos.ts` (registered in `app.config.ts`) declares `android.hardware.touchscreen` (plus `screen.portrait` / `screen.landscape`) as `required="false"` and sets `resizeableActivity="true"`. Without it Play treats the touchscreen as implicitly required and hides the app from non-touch Chromebooks. **This is a manifest change: it ships only in the next store build (AAB), never as an OTA update.**

In Play Console, once the new build is on a track:

1. **Release > Setup > Advanced settings > Device catalog** (or Release > Reach and devices > Device catalog): confirm ChromeOS devices are *not* excluded, and that the uploaded build's supported-device count rose / shows Chromebook models. Look under Device catalog > Device exclusion rules for any rule that excludes the "Chromebook" form factor.
2. **Main store listing > Chromebook screenshots (optional)**: add at least 4 large-screen shots (16:9 or 16:10, 1366x768 or larger). Without them the app can still be listed, but Play may rank it lower on large screens. Ready-made 1366x768 and 1920x1080 web-export shots (Terminal and Paper; today, explore, following, changes, fund ARKK, options) are in `store-assets/android/v2/chromebook/`.
3. Smoke-test on a Chromebook or the Android Studio ChromeOS/desktop emulator: resize the window, snap it half-screen, use mouse wheel, hover, Enter in search, Esc to close the filter sheet.

## 9. CI/CD (GitHub Actions)

Ported from `tradernetwork/vero` (`build.yml`, `ota-update.yml`, `eas-ops.yml`). All three need the **`EXPO_TOKEN`** repo secret (a robot token for the **`tradermatrix`** Expo account, the same account as Vero; the project was moved there from `tradernetwork`, same project id `788fe7b7…`, and `owner` in `app.config.ts` is `tradermatrix`). Production signing uses the **EAS-hosted** upload keystore (`play-upload-key`) and `versionCode` is remote with `autoIncrement`, so nothing about credentials or version codes lives in GitHub.

| Workflow | Trigger | What it does |
|---|---|---|
| `mobile-release.yml` | push a tag `mobile-v*`, or run it by hand with a profile | `tsc` + jest gate, then `eas build -p android --profile production --non-interactive --no-wait --auto-submit`: EAS builds and **submits to the Play PRODUCTION track** when the build finishes (the job ends in about a minute). One run at a time (`concurrency`). Non-production profiles build without submitting. |
| `ota-update.yml` | run by hand: message + channel (`preview` or `production`) | `tsc` + jest gate, then `eas update --channel X --environment X --platform android --clear-cache` (SDK 57 requires `--environment`; the EAS environment of that name must exist). |
| `eas-ops.yml` | run by hand: `status`, `submit-android`, `submit-android-internal` or `release-android-production` | `status` lists builds/updates/channel and whether a Play submit key exists. `submit-android` submits the newest **finished production-profile** build (by id) to the Play **production** track; `submit-android-internal` submits it to the **internal testing** track only (the `internal` submit profile). `release-android-production` builds this ref and submits that build to **production** (Google review still applies). |

**Release an app build:** make sure `version` in `mobile/app.config.ts` is what you want (it is also the OTA runtime), then
```bash
git tag mobile-v1.0.1 && git push origin mobile-v1.0.1
```
The tag is only a trigger: the build uses the `app.config.ts` version, and the workflow warns if the tag disagrees. Watch the build on expo.dev; the submit to the **production** track happens automatically after it, then Google reviews it (see "Store releases go to production" below).

**Ship a JS-only fix (OTA):** Actions → *OTA update (Android)* → Run workflow → pick the channel and a message. It reaches installs on the **same runtime** (the `app.config.ts` version) at their next cold launch. Native code, plugins or a version change need a new build instead. Note the preview APKs from before 1.0.0 are on runtime 0.1.0 and no longer receive OTAs from `main`; a preview OTA now targets runtime 1.0.0 builds.

**One-time step: a Google Play service-account key goes on EAS, not GitHub.** Without it, `eas submit` and `--auto-submit` cannot publish, so every submitting path first runs `scripts/play/check-submit-key.mjs`, which fails **before the build is queued** with: *"No Google Play service-account key on EAS for pro.tickertrace.app … see docs/PLAY_RELEASE.md, section CI/CD"*. Two ways, both from `mobile/` (dry run unless `--apply`; they print only the service account's `client_email` and key ids, never a private key; idempotent):

1. **Reuse Vero's key (preferred; same Expo account).** Vero's service account (`eas-play-submit@…`) already sits on the `tradermatrix` account, so it only needs attaching to this app. In Play Console it must also be granted access to the `pro.tickertrace.app` listing (Users and permissions → invite the service-account email with release permissions).
   ```bash
   node scripts/play/upload-play-submit-key-to-eas.mjs --use-existing eas-play-submit@<project>.iam.gserviceaccount.com          # or the key id; dry run
   node scripts/play/upload-play-submit-key-to-eas.mjs --use-existing eas-play-submit@<project>.iam.gserviceaccount.com --apply
   ```
   An unknown key lists the account's keys by id and email (never contents). This calls only `setGoogleServiceAccountKeyForSubmissions`.
2. **Upload a new key.** Play Console → Setup → API access → create a service account with release permissions and a JSON key, then
   ```bash
   node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json          # dry run
   node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json --apply
   ```
   (`createGoogleServiceAccountKey` then `setGoogleServiceAccountKeyForSubmissions`.)

Check it with `node scripts/play/check-submit-key.mjs` or the `eas-ops` → `status` action. The scripts address the app as `@tradermatrix/tickertrace` (`EAS_APP_FULL_NAME` overrides, e.g. `@tradernetwork/tickertrace` if the transfer is not done yet). **Merge the `owner` change only after the transfer completes:** `eas` rejects a project whose `owner` differs from the account that holds the project id. Whoever moves `EXPO_TOKEN` to a `tradermatrix` token (GitHub secret and `~/secrets/tickertrace-play/expo-token`) does not need to touch the workflows.

`eas.json` submit profiles: `production` (track `production`, the default for every build, tag or auto-release) and `internal` (track `internal`, only via `eas-ops` → `submit-android-internal`).

## 10. Auto-release on push to main

`.github/workflows/mobile-auto-release.yml` releases the app on every push to `main` that changes `mobile/**` (docs, tests and `scripts/` do not ship the app, so they do not trigger it), the way Vercel releases the website and the Vultr sync releases the API.

**Gate: nothing ships on red.** The workflow runs mobile `tsc` + `jest`, then waits for the repo's own `CI` run for the same commit (pytest, next build, dashboard tests, mobile) and aborts unless it succeeded.

**What it ships** (`mobile/scripts/release/decide.cjs`, unit-tested in `mobile/__tests__/release-decide.test.ts`). It computes the current Android native fingerprint (`eas fingerprint:generate --platform android --environment production`) and compares it with the newest live production build on EAS (`eas build:list`, a queued build counts, so a second push never builds twice):

| Situation | Action |
|---|---|
| fingerprint unchanged, same app version | **OTA** to the `production` channel: `eas update --channel production --environment production --platform android --clear-cache --message "<commit subject> (<sha>)"` |
| fingerprint changed | **Build**: `eas build --profile production --auto-submit` (Play **production** track, Google review applies). **No OTA for that commit.** |
| `version` in `app.config.ts` differs from the latest build's | **Build** (a new runtime has no binary to receive an OTA) |
| no production build, or its fingerprint is not recorded | **Blocked**: the run goes red and ships nothing; release once by hand (`git tag mobile-v… && git push origin mobile-v…`) |
| `MOBILE_AUTO_RELEASE` is `false` | Nothing: logs and exits |

**Why a native change never gets an OTA.** `runtimeVersion` is the `appVersion` policy, so an OTA reaches every install on that *app version*. If native code changed but the version did not, the old binary and the JS would no longer match and the OTA could crash installs on the old binary. So the change is built as a binary instead. **Bump `version` in `app.config.ts` in the same PR as any native change** (a new dependency with native code, a plugin, permissions, `app.config.ts` native fields). The version bump gives the new binary its own runtime, so later OTAs reach only binaries that contain the native code; without it, the old and new binaries share a runtime and OTAs reach both. The workflow's build message says so.

**One release at a time.** All mobile workflows share the `mobile-release` concurrency group. While one runs, only the newest pending run is kept, so a newer push supersedes a queued older one (the newest commit contains the earlier changes too). A run in progress is never cancelled.

**Kill switch** (repo variable `MOBILE_AUTO_RELEASE`, unset means on):
```bash
gh variable set MOBILE_AUTO_RELEASE --body false    # off: pushes log "switched off" and release nothing
gh variable set MOBILE_AUTO_RELEASE --body true     # on again
gh variable get MOBILE_AUTO_RELEASE
```
**Dry run:** Actions → *Mobile auto-release* → Run workflow (dry run on by default) prints the decision (OTA / build / blocked and why) without publishing or building. Use it to check the fingerprint comparison before relying on it; if it always says "build" with no native change, the local and EAS fingerprints are not comparable, so turn the switch off and look at `eas fingerprint:compare`.

**Rollback an OTA** (runtime 1.0.0, channel/branch `production`). List recent updates, then either roll back or republish:
```bash
cd mobile
eas update:list --branch production --platform android --limit 10        # find the bad group id and the last good one
# 1. Roll back: republishes the group published BEFORE the bad one (the bad group must be the latest on its branch and runtime)
eas update:rollback <BAD-GROUP-ID> --platform android --message "rollback: <why>" --non-interactive
# 2. Or republish a specific earlier group as the newest update
eas update:republish --group <GOOD-GROUP-ID> --destination-channel production --platform android --message "republish <good>" --non-interactive
```
Installs pick the rollback up at their next cold launch. To stop further releases while you investigate, set `MOBILE_AUTO_RELEASE` to `false` first. A bad **binary** cannot be rolled back (Play never accepts a lower versionCode): halt the rollout in Play Console and ship a fixed build (section 7). The manual **OTA update (Android)** workflow (`ota-update.yml`) can also publish a fix to a channel by hand.

### Store releases go to production (decision 2026-10-13)
Every store build, from a `mobile-v*` tag or from the auto-release's native-change path, is submitted to the Play **production** track with `releaseStatus: completed`; there is no internal-track stop unless you ask for one (`eas-ops` → `submit-android-internal`). The reasoning: the old TWA was live while the native app sat on the internal track, and "why would we have broken stuff out there". So:
- **Google review still applies to every store build.** A production submission is not live until Google approves it, which can take hours to days, and OTAs published meanwhile only reach installs that already have a binary on that runtime.
- **A native release cannot be rolled back to a lower versionCode.** Play never accepts a lower one. If a store build is bad, **halt the rollout in Play Console** (Release → Production → Halt rollout; installs that already have it keep it) and ship a **higher** versionCode (EAS `autoIncrement` provides it: push the fix, or tag again). The old TWA's versionCode is below the native app's, so it cannot be restored either.
- JS-only changes are **not** store releases: they keep shipping as OTAs to the `production` channel, which is also the faster fix path for most bugs (rollback commands above).
- The auto-release now means a push by anyone to `main` that changes native code or the app version results in a **public** store submission. Keep native changes deliberate (bump `version` with them) and use the kill switch (`MOBILE_AUTO_RELEASE=false`) while preparing risky ones.

### Native builds run on the GitHub runner by default (`MOBILE_BUILD_MODE`)
EAS's Free plan allows a limited number of Android cloud builds a month and the quota is **shared with Vero** (both live on the `tradermatrix` account); it ran out on 2026-10-13 (resets Nov 1). The repo is public, so GitHub Actions minutes are free and `ubuntu-latest` ships a JDK and the Android SDK. So every native build (tag release, auto-release native path, `eas-ops` → `release-android-production`) uses the composite action `.github/actions/native-build`, which by default (**mode `local`**):
1. frees runner disk, sets up Java 17 and Gradle caching;
2. `eas build --platform android --profile production --local --output build.aab`: uses the **remote EAS credentials** (our upload keystore) and the **remote versionCode** counter (`appVersionSource: remote`, `autoIncrement`), and does not use the EAS build quota;
3. `eas submit --platform android --profile production --path build.aab` to the Play **production** track, retried up to 3 times because Expo's submit worker sometimes fails to start ("Failed to create worker instance");
4. only after the submission succeeds, records the binary's native fingerprint as a git tag `mobile-fp/<appVersion>/<fingerprint>/<versionCode>` (pushed with the workflow's `GITHUB_TOKEN`, which does not trigger other workflows). **Local builds never appear in `eas build:list`**, so these tags are how the auto-release's next decision knows what is shipped: it takes the newest of the EAS builds and these tags, and an unchanged fingerprint then means OTA again.

Switch back to EAS cloud builds (a paid plan, or quota left) with `gh variable set MOBILE_BUILD_MODE --body cloud` (`local` is the default when unset), or per run with the `build_mode` input of `mobile-release.yml`. Cloud mode is the previous behaviour (`eas build --no-wait --auto-submit`). Local builds take roughly 20 to 40 minutes on the runner (the job allows 90 to 120); the signed AAB is not kept as an artifact, so a failed submit means re-running the workflow.

### ABIs: keep x86_64 (Chromebooks), arm64-v8a and armeabi-v7a
The local build ships **arm64-v8a, armeabi-v7a and x86_64**. **Do not drop x86_64.** It is *not* emulator-only: most Intel/AMD Chromebooks are x86_64, and Google Play filters installs by the native ABIs inside the bundle, so an AAB without `lib/x86_64` is simply unavailable on them (we did a ChromeOS-readiness pass and Chromebook availability was an explicit requirement). Only 32-bit x86 is left out (effectively dead). The composite action fails the build if the AAB lacks any of the three (`unzip -l build.aab`).

versionCode 109 was built ARM-only by mistake (the first fix for the lint OOM below cut ABIs); 110 supersedes it with all three.

The runner's `OutOfMemoryError: Metaspace` came from the Android **lint daemon** (`lintVitalAnalyzeRelease`), not from the C++ compile. It is fixed without touching ABIs: a user-level `gradle.properties` with real heap/metaspace and no daemon, plus an init script (`~/.gradle/init.d/no-lint-vital.gradle`) that disables every module's `lintVital*` task for the build. We do not gate on Android lint (our CI is tsc, jest, pytest and the builds themselves). If three ABIs ever run the runner out of memory again, add swap (`sudo fallocate -l 8G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`) before cutting an ABI.
