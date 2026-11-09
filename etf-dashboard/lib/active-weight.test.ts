import test from 'node:test';
import assert from 'node:assert/strict';
import { activeWeightDeltas } from './active-weight.ts';
import type { Holding } from './holdings.ts';

function h(ticker: string, weight: number, shares: number, mv: number): Holding {
    return { Date: '2026-10-01', 'ETF Ticker': 'AVIV', Name: ticker, Ticker: ticker,
        Weight: weight, 'Share Quantity': shares, 'Market Value': mv };
}

test('implied price jump >5x with no recognised split is zeroed, not a fake sell', () => {
    // A: shares 1,333,518 -> 25,381, price ~26x (not a split). B untouched.
    const prev = [h('A', 10, 1_333_518, 1_000_000), h('B', 90, 100, 9_000_000)];
    const curr = [h('A', 1.2, 25_381, 1_000_000 * 26 * 25_381 / 1_333_518), h('B', 98.8, 100, 9_000_000)];
    const r = activeWeightDeltas(curr, prev);
    assert.equal(r.get('AVIV|A||'), 0);
});

test('ordinary price move is still priced into drift', () => {
    const prev = [h('A', 50, 100, 5000), h('B', 50, 100, 5000)];
    const curr = [h('A', 52.4, 100, 5500), h('B', 47.6, 100, 5000)];
    const r = activeWeightDeltas(curr, prev);
    assert.ok(Math.abs(r.get('AVIV|A||')!) < 0.1);
});
