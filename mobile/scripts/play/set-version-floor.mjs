#!/usr/bin/env node
// Raise EAS's remote Android versionCode counter so the next `eas build --profile production` (autoIncrement)
// produces a versionCode HIGHER than anything already on Google Play (the Chrome TWA's). Play rejects any
// upload whose versionCode is not strictly greater than every versionCode ever uploaded to the listing.
//
//   node scripts/play/set-version-floor.mjs 57            # DRY RUN: shows current and what would be set
//   node scripts/play/set-version-floor.mjs 57 --apply    # writes it
//
// Pass the HIGHEST versionCode shown in Play Console (Release > App bundle explorer, or any track's
// release details). The next build then gets 57 + 1 = 58. Only ever raises the counter; refuses to lower it.
import { APP_FULL_NAME, APP_ID, gql } from './lib.mjs';

const floor = Number(process.argv[2]);
const apply = process.argv.includes('--apply');
if (!Number.isInteger(floor) || floor < 1) throw new Error('usage: set-version-floor.mjs <highest Play versionCode> [--apply]');

const d = await gql(
  `query($n:String!,$id:String!){ app{ byFullName(fullName:$n){ id latestAppVersionByPlatformAndApplicationIdentifier(platform:ANDROID, applicationIdentifier:$id){ buildVersion storeVersion runtimeVersion } } } }`,
  { n: APP_FULL_NAME, id: APP_ID },
);
const app = d.app.byFullName;
const cur = app.latestAppVersionByPlatformAndApplicationIdentifier;
const curN = cur ? Number(cur.buildVersion) : 0;
console.log(`EAS remote versionCode now: ${curN || 'none'} (store version ${cur?.storeVersion ?? '-'})`);
console.log(`Requested floor           : ${floor}  ->  the next production build will be versionCode ${floor + 1}`);
if (floor <= curN) {
  console.log('The EAS counter is already at or above that floor. Nothing to do (this script only raises it).');
  process.exit(0);
}
if (!apply) {
  console.log('\nDRY RUN: nothing was changed. Re-run with --apply.');
  process.exit(0);
}
await gql(
  `mutation($i:AppVersionInput!){ appVersion{ createAppVersion(appVersionInput:$i){ id buildVersion } } }`,
  { i: { appId: app.id, platform: 'ANDROID', applicationIdentifier: APP_ID, storeVersion: cur?.storeVersion ?? '0.1.0', buildVersion: String(floor), runtimeVersion: cur?.runtimeVersion ?? '0.1.0' } },
);
console.log(`Set. The next production build will use versionCode ${floor + 1}.`);
