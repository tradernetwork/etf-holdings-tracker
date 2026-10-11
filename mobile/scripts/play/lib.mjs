// Shared helpers for the Play release scripts. Secrets are read from ~/secrets/tickertrace-play and are
// NEVER printed: logs carry only ids, counts and public certificate fingerprints.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SECRETS = process.env.TT_PLAY_SECRETS ?? path.join(os.homedir(), 'secrets', 'tickertrace-play');
export const APP_FULL_NAME = '@tradernetwork/tickertrace';
export const APP_ID = 'pro.tickertrace.app';
// The Play upload-key SHA-256, known only as its first and last bytes (confirmed against Play Console).
export const EXPECT_PREFIX = '83:78:2F';
export const EXPECT_SUFFIX = 'A3:A9';

export const readToken = () => fs.readFileSync(path.join(SECRETS, 'expo-token'), 'utf8').trim();

export async function gql(query, variables = {}) {
  const r = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${readToken()}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error('EAS GraphQL: ' + j.errors.map((e) => e.message).join('; '));
  return j.data;
}

/** "Key store password: xxx" style lines from PWABuilder's signing-key-info.txt. */
export function readKeyInfo() {
  const text = fs.readFileSync(path.join(SECRETS, 'signing-key-info.txt'), 'utf8');
  const get = (label) => {
    const m = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, 'mi').exec(text);
    if (!m) throw new Error(`signing-key-info.txt has no "${label}" line`);
    return m[1];
  };
  return { keystorePassword: get('Key store password'), keyAlias: get('Key alias'), keyPassword: get('Key password') };
}

/** SHA-256 of the keystore's leaf certificate, via openssl (passwords go through env vars, not argv). */
export function localSha256(keystorePath, password) {
  const env = { ...process.env, TT_KS_PASS: password };
  const pem = execFileSync('openssl', ['pkcs12', '-legacy', '-in', keystorePath, '-passin', 'env:TT_KS_PASS', '-nokeys', '-clcerts'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  const out = execFileSync('openssl', ['x509', '-noout', '-fingerprint', '-sha256'], { input: pem, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  return out.trim().split('=')[1].toUpperCase();
}

export const fingerprintMatchesPlay = (fp) => fp.startsWith(EXPECT_PREFIX) && fp.endsWith(EXPECT_SUFFIX);

export async function appAndCredentials() {
  const d = await gql(
    `query($n:String!,$id:String!){ app{ byFullName(fullName:$n){ id ownerAccount{ id name }
       androidAppCredentials(filter:{applicationIdentifier:$id}){ id applicationIdentifier
         googleServiceAccountKeyForFcmV1{ id }
         androidAppBuildCredentialsList{ id name isDefault androidKeystore{ id type keyAlias sha256CertificateFingerprint } } } } } }`,
    { n: APP_FULL_NAME, id: APP_ID },
  );
  return d.app.byFullName;
}
