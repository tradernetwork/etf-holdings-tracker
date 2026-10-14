// Pure decision logic for the auto-release workflow: ship a JS-only change as an OTA, or build a new binary.
// CommonJS so the CLI (decide.mjs) and Jest share it.
//
// Why both a fingerprint AND a version check: runtimeVersion is the `appVersion` policy, so an OTA only reaches binaries built at
// the SAME app version. If the native fingerprint changed but the version did not, an OTA published to that runtime would
// hit old binaries whose native code no longer matches the JS: it can crash them. So a native change never gets an OTA; it gets a
// store build (and it is up to a human to bump `version` when they want a new runtime). A version change with no binary at
// that version has nobody to receive an OTA, so it also needs a build.

const LIVE = new Set(['FINISHED', 'IN_PROGRESS', 'IN_QUEUE', 'NEW', 'PENDING_CANCEL_QUEUED']);

/** The newest non-failed, non-cancelled production build: a build still in the queue counts, so a second push never builds twice. */
function pickBaseline(builds) {
  const live = (Array.isArray(builds) ? builds : []).filter((b) => b && LIVE.has(String(b.status || '').toUpperCase()));
  live.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const b = live[0];
  if (!b) return null;
  return {
    id: b.id,
    status: b.status,
    appVersion: b.appVersion ?? null,
    hash: (b.fingerprint && b.fingerprint.hash) || b.fingerprintHash || null,
  };
}

/**
 * Binaries built on the GitHub runner (`eas build --local`) never appear in `eas build:list`, so each one is recorded as a git
 * tag `mobile-fp/<appVersion>/<fingerprint>/<versionCode>` (created only after the Play submission succeeded). Lines are
 * `<tag name without refs/tags/>|<ISO creator date>`. They count as finished builds when picking the baseline.
 */
function tagsToBuilds(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const [name, createdAt] = line.trim().split('|');
    const m = /^mobile-fp\/([^/]+)\/([0-9a-f]{40})(?:\/(\d+))?$/.exec(name || '');
    if (!m) continue;
    out.push({ id: `tag:${name}`, status: 'FINISHED', createdAt: createdAt || '', appVersion: m[1], fingerprint: { hash: m[2] }, versionCode: m[3] ? Number(m[3]) : null });
  }
  return out;
}

/** `eas fingerprint:generate --json` output: {hash, sources} (tolerates a wrapper object). */
function localHash(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  return (j && (j.hash || (j.fingerprint && j.fingerprint.hash))) || null;
}

/**
 * @returns {{action: 'ota'|'build'|'skip'|'blocked', reason: string}}
 *  ota     publish an OTA to the production channel
 *  build   queue a production build with --auto-submit (Play production track); NO OTA for this commit
 *  skip    release switched off
 *  blocked cannot tell (no baseline / no fingerprint): nothing ships, a human must look
 */
function decide({ enabled, appVersion, localFingerprint, baseline }) {
  if (enabled === false || String(enabled).toLowerCase() === 'false') {
    return { action: 'skip', reason: 'MOBILE_AUTO_RELEASE is "false": auto-release is switched off.' };
  }
  if (!localFingerprint) {
    return { action: 'blocked', reason: 'Could not compute the current native fingerprint, so nothing was released.' };
  }
  if (!baseline) {
    return { action: 'blocked', reason: 'No production build on EAS to compare against. Release once by hand (push a mobile-v* tag), then auto-release can take over.' };
  }
  if (!baseline.hash) {
    return { action: 'blocked', reason: `The latest production build (${baseline.id}) has no fingerprint recorded on EAS, so native changes cannot be ruled out. Release by hand (mobile-v* tag) to record one.` };
  }
  if (baseline.appVersion && appVersion && baseline.appVersion !== appVersion) {
    return { action: 'build', reason: `App version is ${appVersion} but the latest production build is ${baseline.appVersion}. A new runtime has no binary to receive an OTA, so build one.` };
  }
  if (baseline.hash !== localFingerprint) {
    return { action: 'build', reason: `Native fingerprint changed (${baseline.hash.slice(0, 8)} -> ${localFingerprint.slice(0, 8)}) at app version ${appVersion}. An OTA could crash installs on the old binary, so a binary is built and submitted instead; no OTA for this commit. Bump "version" in app.config.ts with native changes: otherwise the old and new binaries share a runtime and later OTAs reach both.` };
  }
  return { action: 'ota', reason: `Native fingerprint unchanged (${localFingerprint.slice(0, 8)}) at app version ${appVersion}: a JS-only change, safe as an OTA.` };
}

module.exports = { decide, pickBaseline, localHash, tagsToBuilds, LIVE };
