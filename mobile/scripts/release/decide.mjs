#!/usr/bin/env node
// CLI for the auto-release workflow. Reads the current fingerprint and the production build list, prints and exports the decision.
//   node scripts/release/decide.mjs --enabled true --app-version 1.0.0 --local fp.json --builds builds.json [--tags fp-tags.txt]
// Writes `action=` and `reason=` to $GITHUB_OUTPUT when set. Exit code is 0 for ota/build/skip and 1 for blocked.
import fs from 'node:fs';
import decideLib from './decide.cjs';

const { decide, pickBaseline, localHash, tagsToBuilds } = decideLib;
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^[^[{]*/, ''));

const result = decide({
  enabled: arg('enabled') ?? 'true',
  appVersion: arg('app-version'),
  localFingerprint: arg('local') ? localHash(readJson(arg('local'))) : null,
  // EAS cloud builds plus the fingerprint tags of binaries built on the runner (--tags file); the newest live one is the baseline.
  baseline: arg('builds') || arg('tags')
    ? pickBaseline([...(arg('builds') ? readJson(arg('builds')) : []), ...(arg('tags') && fs.existsSync(arg('tags')) ? tagsToBuilds(fs.readFileSync(arg('tags'), 'utf8')) : [])])
    : null,
});
console.log(`${result.action}: ${result.reason}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `action=${result.action}\nreason=${result.reason.replace(/\n/g, ' ')}\n`);
process.exit(result.action === 'blocked' ? 1 : 0);
