# Notifications go-live runbook (single-device test)

Prepared 2026-10-11. **Nothing in this document has been run against production, and nothing here enables notifications.** Server (#151) and client (#149) are merged and OFF: `NOTIFICATIONS_ENABLED` is absent from the box's `api/.env`, and `EXPO_PUBLIC_NOTIFICATIONS_BACKEND` is unset in every build and update.

## 0. Read this first: three things stand between us and a real push

| # | Blocker | Who | Status |
|---|---|---|---|
| 1 | **The v3 preview APK cannot get a push token.** On Android, `getExpoPushTokenAsync` needs Firebase inside the binary (`google-services.json` via `android.googleServicesFile`). `app.config.ts` has none, so the library rejects with *"Unable to get Firebase Messaging instance. Did you configure `googleServicesFile` path in app config?"* (verified in expo-notifications 57.0.22's `PushTokenModule.kt`). Our client swallows that and lands in the `awaitingBuild` state ("token: null"). So an OTA alone **cannot** turn push on for v3: a **new native build (v4)** with the file is required. | user (Firebase) + build | open |
| 2 | **FCM V1 service-account key must be uploaded to EAS** so Expo's push service can deliver to Android. Not verifiable from this box (no Expo login or `EXPO_TOKEN` here; `eas whoami`: not logged in). Treat as **missing** until the user checks `eas credentials` / the expo.dev Credentials page. We cannot do this step with the Expo token we hold: the Firebase side needs the user's Google account, and the key upload is interactive (CLI) or a dashboard click. | user | open |
| 3 | Server flag + client flag (sections 2 and 3), both small and reversible. | us, after go-ahead | ready |

The OTA/flag path in section 2 is still the right way to switch the *client* on and off for preview testers once v4 is installed.

## 1. Dry run on real data (done, nothing sent)

`scripts/notifications_dry_run.py` runs the real `build_events` + `build_digest` (the exact functions the worker calls) for synthetic follow lists on the repo's real history. It opens no database and replaces the Expo delivery functions with tripwires that raise, so even a bug cannot send.

```bash
python3 scripts/notifications_dry_run.py                     # current real history
python3 scripts/notifications_dry_run.py --simulate-monday   # newest weekend file treated as the next market day (symlinks in a temp dir; repo untouched)
python3 scripts/notifications_dry_run.py --follow fund:MSTY ticker:NVDA --out /tmp/x.md
```
Full output of both runs: `/tmp/tt-notify-dryrun.md` (not committed). Samples:

**Today's real data (as of 2026-10-09)**, follower of `fund:MSTY fund:ARKK ticker:NVDA ticker:TSLA fund:AVUV`:
> **TickerTrace · 2026-10-09**
> FDRS trimmed NVDA (-0.55 pp); FDRS added to TSLA (+0.05 pp); AVUV closed FRME (-0.02 pp); +3 more updates

Ticker-only follower (`NVDA`, `TSLA`):
> **TickerTrace · 2026-10-09**
> FDRS trimmed NVDA (-0.55 pp); FDRS added to TSLA (+0.05 pp); AVUS trimmed NVDA (-0.01 pp)

`fund:ARKK` only, and a ticker nobody moved: **would send nothing** (empty digest is recorded as `empty`; no push).

**Simulated Monday** (ARK returning from the 2026-09-25 gap), `fund:ARKK` only:
> **TickerTrace · 2026-10-12**
> ARKK has refreshed: changes since Sep 25 are not daily moves

Mixed follower in the same run: `CMAG trimmed NVDA (-2.81 pp); CMAG trimmed TSLA (-0.71 pp); ARKK has refreshed: changes since Sep 25 are not daily moves`.

What the checks showed (the script exits non-zero if any fails):
- **No catch-up fund leaks as a move.** In the simulated Monday all six ARK funds are catch-up; none appears as a trade for ticker or fund followers, and the only ARK text is the one informational line, and only for a device that explicitly follows that fund.
- **Significance rules apply.** Every trade is at or above its fund's `_significance_threshold` on `activeWeightDelta` (never raw weight).
- **Empty digests send nothing.** `selected == []` leaves `payload.body` empty and the job stores status `empty`.
- **Stale funds are excluded entirely** (today ARKK/ARKQ/... carry 09-25 rows, so a plain ARKK follower correctly gets nothing today).

Honest-wording observations (no change made; for the user to decide):
1. `pp` is percentage points of that fund's own book (active weight). The body doesn't say "of the fund"; the title carries only the snapshot date. Acceptable for a test, worth a tooltip in-app later.
2. The 0.01 pp floor for broad funds is the product's signal floor, but as a *push* it is chatty: a 5-follow device got 6 events on an ordinary day, three of them 0.01 to 0.02 pp. If it feels noisy on the phone, a higher notification-only floor (for example 0.05 pp) is a one-line change in `build_events`.
3. Timing: the digest is prepared at the first sync after the scrape lands (about 18:00 UTC, so roughly 2 p.m. ET, mid-session), then delivered by the next 15-minute hook run. It says "disclosure update", not a live trade feed, and the title shows the data date.
4. First digest after enabling: if a device registers after the server is on and today's `source_runs` row does not exist yet, the next worker run prepares today's digest for it immediately. Expect **two** pushes in the first test (the real digest and the queued test).

## 2. Client flag: OTA to the `preview` channel only

**Inlining (verified here).** `process.env.EXPO_PUBLIC_*` is replaced at bundle time by Expo CLI; the code reads it with literal dot notation (`mobile/lib/notifyApi.ts`: `process.env.EXPO_PUBLIC_NOTIFICATIONS_BACKEND === "1"`), which is the only form that is inlined. I exported the Android bundle twice from this branch: the flag-on and flag-off Hermes bundles **differ** (`entry-14f5fa05…hbc` vs `entry-fe138ab5…hbc`). Without `--clear` Metro served a stale transform once, so always publish with `--clear-cache`.

**EAS Update specifics (SDK 57):** `eas update` requires `--environment <name>`; the project's `.env` files are then **not** used, only the EAS environment's variables are. So the flag lives in the EAS `preview` environment, never in `eas.json` or git:

```bash
cd mobile
npx eas-cli login                       # the user's Expo account (owner: tradernetwork)
# turn ON for preview only
npx eas-cli env:set preview --name EXPO_PUBLIC_NOTIFICATIONS_BACKEND --value 1 --visibility plaintext --non-interactive
npx eas-cli update --channel preview --environment preview --clear-cache --platform android \
    --message "Enable notifications backend (test)"
npx eas-cli channel:view preview        # confirm which branch/update the channel serves
```
Why this cannot touch production: a `production` update uses `--environment production`, where the variable does not exist, so it inlines `undefined` (off). The production channel and any production build are untouched.

**Roll back (client):**
```bash
npx eas-cli env:delete preview --variable-name EXPO_PUBLIC_NOTIFICATIONS_BACKEND --variable-environment preview --non-interactive   # or env:set it to 0
npx eas-cli update --channel preview --environment preview --clear-cache --platform android --message "Notifications backend off"
# or, to return to the previous update group without a rebuild:
npx eas-cli update:rollback
```
The app picks the update up on the next cold start (it checks on launch, applies on the following launch; two restarts is normal).

**Order matters for the v4 build.** The `preview` build profile may inherit the `preview` environment. Build v4 **before** setting the variable (or build it with the variable set deliberately), so what is baked in is what you intend.

**What else must be true in the binary** (v3 vs v4):
| Requirement | v3 (installed) | v4 (to build) |
|---|---|---|
| `expo-notifications` config plugin | yes (`app.config.ts` plugins) | yes |
| Android 13+ `POST_NOTIFICATIONS` | yes: declared in the library's own `AndroidManifest.xml` (expo-notifications 57.0.22, line 3) and requested at runtime only after the user taps Enable | yes |
| Notification channel `digest` | created at enable time (`setNotificationChannelAsync`) | yes |
| `projectId` for `getExpoPushTokenAsync` | yes: `extra.eas.projectId = 832c4b83-bff1-4577-a1d1-0cee447e72c3` (read by `easProjectId()`) | yes |
| `google-services.json` (FCM) in the APK | **no** | **required** (this PR makes `app.config.ts` pick it up from `GOOGLE_SERVICES_JSON`) |
| FCM V1 key in EAS | unknown, assume no | required |
| Same signing key, so v4 installs over v3 | n/a | preview profile uses the local Play upload key (`credentialsSource: local`): build from the machine that holds `credentials.json` |

`runtimeVersion` is `appVersion`. Preview APKs were built at 0.1.0 and share that runtime, so a preview OTA also reaches any still-installed preview build (harmless: it falls back to `awaitingBuild`). Production builds are **1.0.0**, a separate runtime that never receives preview-channel OTAs; publish an OTA to the production channel/runtime 1.0.0 deliberately.

## 3. FCM + v4 build: exact user steps (about 20 minutes)

1. **Firebase project.** console.firebase.google.com, Add project (any name, Analytics off is fine). Add an **Android app** with package name `pro.tickertrace.app`; download **`google-services.json`**. It is not a secret per Expo's docs, but we keep it out of git via an EAS file variable.
2. **Service-account key (FCM V1).** Firebase console, Project settings, Service accounts, **Generate new private key**: a JSON file. This one IS secret: never commit it, never paste it in chat.
3. **Upload the key to EAS.** Either expo.dev, the `tickertrace` project, Project settings, **Credentials**, Android, `pro.tickertrace.app`, Service Credentials, **FCM V1 service account key**, Add a service account key, upload; or `npx eas-cli credentials -p android` and follow Google Service Account, Manage FCM V1 key, Upload a new service account key. (Source: docs.expo.dev/push-notifications/fcm-credentials.)
4. **Give the build the Firebase file.**
   ```bash
   cd mobile
   npx eas-cli env:set preview --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility sensitive --non-interactive
   # if the CLI rejects that visibility for a file variable, use --visibility secret
   ```
   (`app.config.ts` reads `process.env.GOOGLE_SERVICES_JSON`; for a local build, `GOOGLE_SERVICES_JSON=./google-services.json npx eas-cli build --local ...`.)
5. **Build v4** from the machine with the signing key (`scripts/write-local-credentials.sh` has already produced `credentials.json` there): `npx eas-cli build --profile preview --platform android`. Install the new APK over v3 (same key, same package: it upgrades in place and keeps follows).
6. Then do section 2 (flag on) and section 4 (server on).

## 4. Server enable plan (the Vultr box)

Preconditions: #151's `sync_data.sh` is deployed (check `tail /var/log/tickertrace-sync.log`, and `curl -s https://api.tickertrace.pro/health` commit equals main).

```bash
ssh vultr
cd /home/mphinance/TickerTrace
cp api/.env api/.env.bak-$(date +%F)
grep -q '^NOTIFICATIONS_ENABLED=' api/.env \
  && sed -i 's/^NOTIFICATIONS_ENABLED=.*/NOTIFICATIONS_ENABLED=1/' api/.env \
  || echo 'NOTIFICATIONS_ENABLED=1' >> api/.env
GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --force-recreate api     # env_file changes need a recreate
sleep 8; curl -s http://localhost:8100/health
# 503 means still OFF; 401/422 means the routes are live:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8100/notifications/subscribe -H 'content-type: application/json' -d '{}'
```
**What the 15-minute hook then does** (`sync_data.sh`): `notifications_enabled` is now true, so after each healthy sync it takes `/var/lock/tickertrace-notify.lock` and runs `timeout -k 10 240 docker compose exec -T api python -m api.notification_job`, logging one line: `notifications: {"enabled": true, "prepared": N, "accepted": M, "receipts": K}`. The worker itself stops after 120 s. If a worker is still running the next run logs `notification worker still running — skipping`; a held sync lock logs `previous sync still holds the lock — skipping`. While disabled it does nothing at all (no log lines).

**Roll back (server), at any time:**
```bash
sed -i 's/^NOTIFICATIONS_ENABLED=.*/NOTIFICATIONS_ENABLED=0/' api/.env
GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --force-recreate api
docker compose exec -T api python -m api.notification_ops purge --yes    # optional: delete the test device + its data
# the hook goes silent again within one run; routes answer 503
```

## 5. The single-device test (user + us, in this order)

1. v4 installed, FCM key uploaded, `GOOGLE_SERVICES_JSON` in the build, server flag **ON**, then client flag **ON** + OTA published (sections 2, 3, 4). Cold-start the app twice.
2. In the app: follow a ticker and a fund (Following), accept the opt-in sheet or toggle Settings, Notifications; grant the Android permission. The app mints the token and calls `POST /notifications/subscribe`, then `PUT /notifications/follows`.
3. On the box, confirm exactly one device and no secrets in the output:
   `docker compose exec -T api python -m api.notification_ops status`
4. Queue **one** test push (no bearer needed; refuses unless exactly one device exists):
   `docker compose exec -T api python -m api.notification_ops queue-test`
   The normal worker sends it on the next run (at most 15 minutes), or run it now: `docker compose exec -T api python -m api.notification_job`.
   (The public route `POST /notifications/test-push` would do the same, but it needs the device's bearer secret, which only the phone's keystore holds; that is why the ops tool exists. Routes live at `/notifications/...` on the API host, not under `/api/v1`.)
5. Watch (section 6). After ~15 minutes Expo's receipt arrives and the outbox row moves `accepted` to `delivered`.
6. Also expect today's real digest (see observation 4 in section 1). Tapping a notification opens the public Holdings page (`url` in the payload).
7. Finish: toggle notifications off in the app (the client sends `DELETE /notifications/device`), then `status` should show `devices: 0`; or run `purge --yes`.

## 6. What to watch

- Sync log: `tail -f /var/log/tickertrace-sync.log`. Healthy: `notifications: {"enabled": true, "prepared": 1, "accepted": 1, "receipts": 0}`. Problems: `notification worker failed or timed out`, `... skipping`.
- Container: `docker logs tickertrace-api --tail 100`. Logs hold counts and safe error codes only, never tokens, secrets or follows.
- Outbox: `api.notification_ops status` shows per-device rows `pending, sending, accepted, delivered` (or `failed` with an error code):
  - `DeviceNotRegistered`: token invalid or app uninstalled; the device is pruned automatically.
  - `InvalidCredentials` / FCM errors: the FCM V1 key is missing or wrong in EAS (section 3, step 3).
  - `MessageRateExceeded`: retried with backoff (up to 5 attempts, 15 min to 4 h).
  - `receipt_missing`: no receipt after 24 h; delivery is best-effort, Expo has no SLA.
- Expo's own push tool (expo.dev/notifications) can confirm the token independently, but sending from it is a separate, manual push; not part of this runbook.

## 7. Quotas and limits (for the test)

- Per IP: subscribe 30/hour; follows read 60/min, write 20/hour; delete 30/hour; test-push 10/hour; digests 60/min. Per device (shared across workers): follows 20/hour, token updates 10/hour, **test-push 3/day**. Per token: **5 unauthenticated enrollments/day** (reinstall recovery counts). 429 means back off; the client does not retry quota 429s indefinitely.
- Delivery: up to 200 messages per worker run, 5 attempts, unsent work expires after 24 h; one logical digest per device per trading day.
- Data: outbox rows kept 30 days, idle devices 180 days; `purge --yes` removes everything immediately.

## 8. Go / no-go checklist for the user

- [ ] Firebase project created, `google-services.json` downloaded (section 3, steps 1-2)
- [ ] FCM V1 service-account key uploaded in EAS (step 3)
- [ ] v4 preview APK built and installed over v3 (steps 4-5)
- [ ] OK to set `NOTIFICATIONS_ENABLED=1` on the box for the test window, with rollback ready (section 4)
- [ ] OK to publish the `preview` OTA with the flag on (section 2)
- [ ] Decide: keep the 0.01 pp floor for pushes, or raise it for notifications only (section 1, observation 2)
