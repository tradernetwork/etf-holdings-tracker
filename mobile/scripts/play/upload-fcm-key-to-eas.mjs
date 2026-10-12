#!/usr/bin/env node
// Upload a Firebase FCM V1 service-account key (the JSON from Firebase console, Project settings,
// Service accounts, Generate new private key) to EAS for pro.tickertrace.app, so Expo's push service can
// deliver to Android. The key is a SECRET: pass its path, never paste it anywhere.
//
//   node scripts/play/upload-fcm-key-to-eas.mjs ~/secrets/tickertrace-play/firebase-service-account.json          # dry run
//   node scripts/play/upload-fcm-key-to-eas.mjs ~/secrets/tickertrace-play/firebase-service-account.json --apply
//
// Needs the Android app credentials to exist (run upload-keystore-to-eas.mjs first). Prints no secret.
import fs from 'node:fs';
import { APP_ID, appAndCredentials, gql } from './lib.mjs';

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file || file.startsWith('--')) throw new Error('usage: upload-fcm-key-to-eas.mjs <service-account.json> [--apply]');
const raw = fs.readFileSync(file, 'utf8');
const j = JSON.parse(raw);
if (j.type !== 'service_account' || !j.private_key || !j.client_email || !j.project_id) throw new Error('That file is not a Google service-account key.');
console.log(`service account  : ${j.client_email} (Firebase project ${j.project_id})`);

const app = await appAndCredentials();
const creds = app.androidAppCredentials[0];
if (!creds) throw new Error(`EAS has no Android app credentials for ${APP_ID} yet; run upload-keystore-to-eas.mjs --apply first.`);
console.log(`EAS app creds    : ${creds.id}; FCM V1 key currently ${creds.googleServiceAccountKeyForFcmV1 ? 'SET (' + creds.googleServiceAccountKeyForFcmV1.id + ')' : 'not set'}`);
if (!apply) {
  console.log('\nDRY RUN: nothing was changed. Re-run with --apply to upload.');
  process.exit(0);
}
const r = await gql(
  `mutation($id:String!,$c:String!){ androidAppCredentials{ createFcmV1Credential(androidAppCredentialsId:$id, credential:$c){ id googleServiceAccountKeyForFcmV1{ id } } } }`,
  { id: creds.id, c: raw },
);
console.log('uploaded; FCM V1 key id', r.androidAppCredentials.createFcmV1Credential.googleServiceAccountKeyForFcmV1?.id);
