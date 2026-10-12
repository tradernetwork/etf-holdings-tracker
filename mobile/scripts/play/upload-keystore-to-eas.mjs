#!/usr/bin/env node
// Upload the Play UPLOAD keystore to EAS as the default Android build credential for pro.tickertrace.app,
// so `eas build --profile production` signs with hosted credentials (no credentials.json needed).
//
//   node scripts/play/upload-keystore-to-eas.mjs            # DRY RUN: reads only, prints the plan
//   node scripts/play/upload-keystore-to-eas.mjs --apply    # performs the three GraphQL mutations
//
// Reads ~/secrets/tickertrace-play/{expo-token,signing.keystore,signing-key-info.txt}. Prints no secret:
// only ids and the keystore's public SHA-256 fingerprint. Refuses unless that fingerprint matches the
// Play upload key (83:78:2F...A3:A9). Idempotent: does nothing if EAS already holds this exact key.
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, APP_FULL_NAME, SECRETS, appAndCredentials, fingerprintMatchesPlay, gql, localSha256, readKeyInfo, sameFp } from './lib.mjs';

const apply = process.argv.includes('--apply');
const ksPath = path.join(SECRETS, 'signing.keystore');
const info = readKeyInfo();
const fp = localSha256(ksPath, info.keystorePassword);
console.log(`keystore SHA-256 : ${fp}`);
if (!fingerprintMatchesPlay(fp)) throw new Error('This keystore does not match the Play upload-key fingerprint. Refusing.');
console.log('fingerprint      : matches the Play upload key');

const app = await appAndCredentials();
console.log(`EAS app          : ${APP_FULL_NAME} (${app.id}), owner ${app.ownerAccount.name}`);
const creds = app.androidAppCredentials[0] ?? null;
const lists = creds?.androidAppBuildCredentialsList ?? [];
console.log(`EAS Android creds: ${creds ? `app credentials ${creds.id}, ${lists.length} build credential set(s)` : 'none yet'}`);
const already = lists.find((b) => sameFp(b.androidKeystore?.sha256CertificateFingerprint, fp));
if (already) {
  console.log(`Already uploaded: build credentials "${already.name}" (${already.id}), default=${already.isDefault}. Nothing to do.`);
  process.exit(0);
}
console.log('Plan: ' + [
  '1) createAndroidKeystore (PKCS12, alias from signing-key-info.txt)',
  creds ? `2) reuse app credentials ${creds.id}` : `2) createAndroidAppCredentials for ${APP_ID}`,
  '3) createAndroidAppBuildCredentials "play-upload-key", isDefault=true',
].join('\n      '));
if (!apply) {
  console.log('\nDRY RUN: nothing was changed. Re-run with --apply to perform the plan.');
  process.exit(0);
}

const ks = await gql(
  `mutation($i:AndroidKeystoreInput!,$a:ID!){ androidKeystore{ createAndroidKeystore(androidKeystoreInput:$i, accountId:$a){ id sha256CertificateFingerprint } } }`,
  { a: app.ownerAccount.id, i: { base64EncodedKeystore: fs.readFileSync(ksPath).toString('base64'), keystorePassword: info.keystorePassword, keyAlias: info.keyAlias, keyPassword: info.keyPassword } },
);
const keystoreId = ks.androidKeystore.createAndroidKeystore.id;
console.log(`created keystore ${keystoreId}`);
if (!sameFp(ks.androidKeystore.createAndroidKeystore.sha256CertificateFingerprint, fp)) throw new Error('EAS reports a different fingerprint than the local keystore; stop and investigate (the keystore was created but NOT attached).');

let credsId = creds?.id;
if (!credsId) {
  const c = await gql(
    `mutation($app:ID!,$id:String!){ androidAppCredentials{ createAndroidAppCredentials(androidAppCredentialsInput:{}, appId:$app, applicationIdentifier:$id){ id } } }`,
    { app: app.id, id: APP_ID },
  );
  credsId = c.androidAppCredentials.createAndroidAppCredentials.id;
  console.log(`created app credentials ${credsId}`);
}
const b = await gql(
  `mutation($c:ID!,$k:ID!){ androidAppBuildCredentials{ createAndroidAppBuildCredentials(androidAppBuildCredentialsInput:{isDefault:true,name:"play-upload-key",keystoreId:$k}, androidAppCredentialsId:$c){ id isDefault } } }`,
  { c: credsId, k: keystoreId },
);
console.log(`attached build credentials ${b.androidAppBuildCredentials.createAndroidAppBuildCredentials.id} (default)`);

const after = await appAndCredentials();
const ok = after.androidAppCredentials[0]?.androidAppBuildCredentialsList.some((x) => x.isDefault && sameFp(x.androidKeystore?.sha256CertificateFingerprint, fp));
console.log(ok ? 'VERIFIED: EAS now holds the Play upload key as the default Android credential.' : 'WARNING: could not verify the default credential; check `eas credentials -p android`.');
process.exit(ok ? 0 : 1);
