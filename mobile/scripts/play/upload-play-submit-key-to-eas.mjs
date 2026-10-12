#!/usr/bin/env node
// Upload the Google Play SERVICE-ACCOUNT key (Play Console > Setup > API access, then the key JSON of a service
// account with release permissions) to EAS and attach it as the app's submission key, so `eas submit` and
// `--auto-submit` can publish. It goes to EAS, NOT to a GitHub secret. The file is a SECRET: pass its path.
//
//   node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json          # DRY RUN
//   node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json --apply
//
// Prints only the service account's client_email and private_key_id, never the private key. Idempotent: does nothing
// when EAS already uses a key with that client email. Needs the Android app credentials (run upload-keystore-to-eas.mjs first).
//
// GraphQL (checked against EAS by introspection): androidKeystore-style mutations
//   googleServiceAccountKey.createGoogleServiceAccountKey(googleServiceAccountKeyInput:{jsonKey}, accountId)
//   androidAppCredentials.setGoogleServiceAccountKeyForSubmissions(id: <app credentials id>, googleServiceAccountKeyId)
import fs from 'node:fs';
import { APP_ID, appAndCredentials, gql } from './lib.mjs';

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file || file.startsWith('--')) throw new Error('usage: upload-play-submit-key-to-eas.mjs <service-account.json> [--apply]');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
if (j.type !== 'service_account' || !j.private_key || !j.client_email || !j.private_key_id) throw new Error('That file is not a Google service-account key.');
console.log(`service account  : ${j.client_email} (key id ${j.private_key_id}, project ${j.project_id ?? '?'})`);

const app = await appAndCredentials();
const creds = app.androidAppCredentials[0];
if (!creds) throw new Error(`EAS has no Android app credentials for ${APP_ID} yet; run upload-keystore-to-eas.mjs --apply first.`);
const current = creds.googleServiceAccountKeyForSubmissions;
console.log(`EAS app creds    : ${creds.id}; submission key currently ${current ? `SET (${current.clientEmail}, ${current.id})` : 'not set'}`);
if (current && current.clientEmail === j.client_email) {
  console.log('Already attached: EAS uses a key for this service account. Nothing to do.');
  process.exit(0);
}
console.log('Plan: ' + ['1) createGoogleServiceAccountKey (stores the key JSON on the tradernetwork account)', `2) setGoogleServiceAccountKeyForSubmissions on ${creds.id}`].join('\n      '));
if (!apply) {
  console.log('\nDRY RUN: nothing was changed. Re-run with --apply to perform the plan.');
  process.exit(0);
}

const k = await gql(
  `mutation($i:GoogleServiceAccountKeyInput!,$a:ID!){ googleServiceAccountKey{ createGoogleServiceAccountKey(googleServiceAccountKeyInput:$i, accountId:$a){ id clientEmail privateKeyIdentifier } } }`,
  { a: app.ownerAccount.id, i: { jsonKey: j } },
);
const created = k.googleServiceAccountKey.createGoogleServiceAccountKey;
console.log(`created key ${created.id} (${created.clientEmail}, key id ${created.privateKeyIdentifier})`);
await gql(
  `mutation($id:ID!,$k:ID!){ androidAppCredentials{ setGoogleServiceAccountKeyForSubmissions(id:$id, googleServiceAccountKeyId:$k){ id } } }`,
  { id: creds.id, k: created.id },
);
const after = (await appAndCredentials()).androidAppCredentials[0]?.googleServiceAccountKeyForSubmissions;
const ok = after?.id === created.id;
console.log(ok ? `VERIFIED: EAS will submit with ${after.clientEmail}.` : 'WARNING: could not verify the submission key; check `eas credentials -p android`.');
process.exit(ok ? 0 : 1);
