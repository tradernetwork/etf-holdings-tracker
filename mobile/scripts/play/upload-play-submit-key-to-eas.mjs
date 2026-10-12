#!/usr/bin/env node
// Give EAS a Google Play service-account key to submit with (`eas submit`, `--auto-submit`, the eas-ops workflow),
// and attach it as THIS app's submission key. The key lives on EAS, NOT in a GitHub secret. Two ways:
//
//   A) Reuse a key the Expo account already holds (e.g. Vero's `eas-play-submit@...`, same account): attach only.
//      node scripts/play/upload-play-submit-key-to-eas.mjs --use-existing <keyId|clientEmail>            # DRY RUN
//      node scripts/play/upload-play-submit-key-to-eas.mjs --use-existing <keyId|clientEmail> --apply
//      (a key that is not found lists the account's keys by id and client email, never their contents)
//
//   B) Upload a new key JSON (Play Console > Setup > API access, a service account with release permissions):
//      node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json          # DRY RUN
//      node scripts/play/upload-play-submit-key-to-eas.mjs ~/secrets/tickertrace-play/play-service-account.json --apply
//
// Dry run by default. Prints only client_email and key ids, never a private key. Idempotent: does nothing when the app
// already submits with that key. Needs the Android app credentials (run upload-keystore-to-eas.mjs first).
//
// GraphQL (checked against EAS by introspection):
//   googleServiceAccountKey.createGoogleServiceAccountKey(googleServiceAccountKeyInput:{jsonKey}, accountId)   [B only]
//   androidAppCredentials.setGoogleServiceAccountKeyForSubmissions(id: <app credentials id>, googleServiceAccountKeyId)
//   account.byName.googleServiceAccountKeys { id clientEmail }                                                 [A lookup]
import fs from 'node:fs';
import { APP_ID, appAndCredentials, gql } from './lib.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const useIdx = args.indexOf('--use-existing');
const existingRef = useIdx >= 0 ? args[useIdx + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && i !== useIdx + 1);
const usage = 'usage: upload-play-submit-key-to-eas.mjs (--use-existing <keyId|clientEmail> | <service-account.json>) [--apply]';
if (useIdx >= 0 ? !existingRef || existingRef.startsWith('--') : !file) throw new Error(usage);
if (useIdx >= 0 && file) throw new Error(`Give either --use-existing or a JSON file, not both.\n${usage}`);

const app = await appAndCredentials();
const creds = app.androidAppCredentials[0];
if (!creds) throw new Error(`EAS has no Android app credentials for ${APP_ID} yet; run upload-keystore-to-eas.mjs --apply first.`);
const current = creds.googleServiceAccountKeyForSubmissions;
console.log(`EAS app creds    : ${creds.id} (owner ${app.ownerAccount.name}); submission key currently ${current ? `SET (${current.clientEmail}, ${current.id})` : 'not set'}`);

let keyId = null;
let plan;
if (existingRef) {
  const a = await gql(`query($n:String!){ account{ byName(accountName:$n){ googleServiceAccountKeys{ id clientEmail } } } }`, { n: app.ownerAccount.name });
  const keys = a.account.byName.googleServiceAccountKeys ?? [];
  const hit = keys.find((k) => k.id === existingRef || k.clientEmail.toLowerCase() === existingRef.toLowerCase());
  if (!hit) {
    console.log(`No Google service-account key "${existingRef}" on the ${app.ownerAccount.name} account. It holds ${keys.length}:`);
    for (const k of keys) console.log(`  ${k.id}  ${k.clientEmail}`);
    process.exit(1);
  }
  keyId = hit.id;
  console.log(`existing key     : ${hit.clientEmail} (${hit.id}) on ${app.ownerAccount.name}`);
  plan = [`1) setGoogleServiceAccountKeyForSubmissions on ${creds.id} with the existing key ${hit.id}`];
} else {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.type !== 'service_account' || !j.private_key || !j.client_email || !j.private_key_id) throw new Error('That file is not a Google service-account key.');
  console.log(`service account  : ${j.client_email} (key id ${j.private_key_id}, project ${j.project_id ?? '?'})`);
  if (current && current.clientEmail === j.client_email) {
    console.log('Already attached: EAS submits with a key for this service account. Nothing to do.');
    process.exit(0);
  }
  plan = ['1) createGoogleServiceAccountKey (stores the key JSON on the ' + app.ownerAccount.name + ' account)', `2) setGoogleServiceAccountKeyForSubmissions on ${creds.id}`];
  globalThis.__newKey = j;
}
if (keyId && current?.id === keyId) {
  console.log('Already attached: this app already submits with that key. Nothing to do.');
  process.exit(0);
}
console.log('Plan: ' + plan.join('\n      '));
if (!apply) {
  console.log('\nDRY RUN: nothing was changed. Re-run with --apply to perform the plan.');
  process.exit(0);
}

if (!keyId) {
  const k = await gql(
    `mutation($i:GoogleServiceAccountKeyInput!,$a:ID!){ googleServiceAccountKey{ createGoogleServiceAccountKey(googleServiceAccountKeyInput:$i, accountId:$a){ id clientEmail privateKeyIdentifier } } }`,
    { a: app.ownerAccount.id, i: { jsonKey: globalThis.__newKey } },
  );
  const created = k.googleServiceAccountKey.createGoogleServiceAccountKey;
  keyId = created.id;
  console.log(`created key ${created.id} (${created.clientEmail}, key id ${created.privateKeyIdentifier})`);
}
await gql(
  `mutation($id:ID!,$k:ID!){ androidAppCredentials{ setGoogleServiceAccountKeyForSubmissions(id:$id, googleServiceAccountKeyId:$k){ id } } }`,
  { id: creds.id, k: keyId },
);
const after = (await appAndCredentials()).androidAppCredentials[0]?.googleServiceAccountKeyForSubmissions;
const ok = after?.id === keyId;
console.log(ok ? `VERIFIED: EAS will submit with ${after.clientEmail}.` : 'WARNING: could not verify the submission key; check `eas credentials -p android`.');
process.exit(ok ? 0 : 1);
