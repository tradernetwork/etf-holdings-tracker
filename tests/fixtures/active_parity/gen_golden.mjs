// Regenerates golden.json: the website's per-row Δ Weight (computeDiff's
// activeWeightDelta, exactly as lib/holdings-query.ts assigns it) for the fixture
// history next to this file. Needs etf-dashboard deps (papaparse) and Node >= 22.
//   node tests/fixtures/active_parity/gen_golden.mjs
import { register } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dash = path.resolve(here, '../../../etf-dashboard');
// holdings.ts uses extensionless relative imports; let Node resolve them to .ts.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (spec.startsWith('.')) return next(spec + '.ts', ctx);
    throw e;
  }
}`));
process.chdir(here); // holdings.ts reads <cwd>/public/data/history
const h = await import(pathToFileURL(path.join(dash, 'lib/holdings.ts')).href);
const diff = h.getDailyDiff();
const change = new Map();
for (const c of [...diff.newPositions, ...diff.removedPositions, ...diff.changedPositions]) {
  change.set(`${c.fund}|${c.ticker}`, c.activeWeightDelta);
}
const out = {};
for (const r of h.getLatestHoldings()) {
  const fund = r['ETF Ticker'];
  const key = `${fund}|${r.Ticker}`;
  // holdings-query.ts: catch-up fund -> null; otherwise the change's activeWeightDelta, else 0.
  out[key] = Object.prototype.hasOwnProperty.call(diff.catchUpFunds ?? {}, fund) ? null : (change.get(key) ?? 0);
}
writeFileSync(path.join(here, 'golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log(Object.keys(out).length, 'rows');
