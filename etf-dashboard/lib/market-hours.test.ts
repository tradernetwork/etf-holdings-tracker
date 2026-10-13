import test from 'node:test';
import assert from 'node:assert/strict';
import { isTradingDay, tradingDaysBetween } from './marketHours.ts';

test('weekend files are not trading days, so a Saturday scrape is never "the previous snapshot"', () => {
    assert.equal(isTradingDay('2026-10-10'), false);   // Saturday
    assert.equal(isTradingDay('2026-10-09'), true);
    const files = ['2026-10-12', '2026-10-10', '2026-10-09', '2026-10-08'].filter(isTradingDay);
    assert.deepEqual(files, ['2026-10-12', '2026-10-09', '2026-10-08']);
    assert.equal(files[1], '2026-10-09');   // /holdings says "vs Fri Oct 9", like the API
});

test('trading days between snapshots count holidays and missed scrapes the way the API does', () => {
    assert.equal(tradingDaysBetween('2026-10-08', '2026-10-09'), 1);
    assert.equal(tradingDaysBetween('2026-10-09', '2026-10-12'), 1);   // over the weekend
    assert.equal(tradingDaysBetween('2026-10-07', '2026-10-09'), 2);   // Oct 8 scrape missed
    assert.equal(tradingDaysBetween('2026-09-04', '2026-09-08'), 1);   // Labor Day (Sep 7)
    assert.equal(tradingDaysBetween('2026-09-03', '2026-09-08'), 2);
    assert.equal(tradingDaysBetween(null, '2026-10-09'), null);
    assert.equal(tradingDaysBetween('2026-10-09', '2026-10-09'), null);
});
