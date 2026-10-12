#!/usr/bin/env node
// Fails fast, with a clear message, when EAS has no Google Play service-account key for submissions.
// Run before any `eas submit` / `--auto-submit` so a missing key never shows up as a cryptic submit error
// after a 30-minute build. Needs EXPO_TOKEN (CI) or ~/secrets/tickertrace-play/expo-token. Prints no secret.
import { APP_ID, appAndCredentials } from './lib.mjs';

const app = await appAndCredentials();
const key = app.androidAppCredentials[0]?.googleServiceAccountKeyForSubmissions ?? null;
if (!key) {
  const msg = `No Google Play service-account key on EAS for ${APP_ID}, so builds cannot be submitted to Play. ` +
    'Upload it once with mobile/scripts/play/upload-play-submit-key-to-eas.mjs; see docs/PLAY_RELEASE.md, section "CI/CD".';
  console.error(`::error title=No Play submit key on EAS::${msg}`);
  console.error(msg);
  process.exit(1);
}
console.log(`Play submit key on EAS: ${key.clientEmail} (${key.id})`);
