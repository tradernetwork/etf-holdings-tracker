import test from 'node:test';
import assert from 'node:assert/strict';
import { completeChanges } from './complete-changes.ts';

test('all pages are included and pinned to the first snapshot', async () => {
    const original = globalThis.fetch;
    const calls: URL[] = [];
    globalThis.fetch = (async (url: string) => {
        const u = new URL(url); calls.push(u);
        const page = Number(u.searchParams.get('page'));
        return { ok: true, json: async () => ({ pages: 4, snapshot: 'one', asOfDate: '2026-10-12', changes: [{ ticker: `PAGE${page}` }] }) } as Response;
    }) as typeof fetch;
    try {
        const r = await completeChanges('daily');
        assert.deepEqual(r.changes.map(c => c.ticker), ['PAGE1', 'PAGE2', 'PAGE3', 'PAGE4']);
        assert.ok(calls.slice(1).every(u => u.searchParams.get('snapshot') === 'one'));
    } finally { globalThis.fetch = original; }
});
test('a mixed snapshot cannot render as a complete book', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => ({ ok: true, json: async () => ({ pages: 2, snapshot: String(url).includes('page=1') ? 'one' : 'two', asOfDate: '2026-10-12', changes: [] }) } as Response)) as typeof fetch;
    try { await assert.rejects(completeChanges('daily'), /Snapshot changed/); }
    finally { globalThis.fetch = original; }
});
