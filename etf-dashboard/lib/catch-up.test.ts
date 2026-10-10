import test from 'node:test';
import assert from 'node:assert/strict';
import { catchUpFunds, isoDate, rowRefreshed } from './catch-up.ts';

const row = (fund: string, refreshed: unknown, src?: string, date?: string) =>
    ({ 'ETF Ticker': fund, Refreshed: refreshed, Source_Date: src, Date: date });

test('rowRefreshed parses the CSV spellings and booleans', () => {
    assert.equal(rowRefreshed('True'), true);
    assert.equal(rowRefreshed('False'), false);
    assert.equal(rowRefreshed(false), false);
    assert.equal(rowRefreshed(0), false);
    assert.equal(rowRefreshed(''), null);
    assert.equal(rowRefreshed(undefined), null);
});

test('isoDate normalises the date formats the API accepts', () => {
    assert.equal(isoDate('2026-09-25 00:00:00'), '2026-09-25');
    assert.equal(isoDate('9/25/2026'), '2026-09-25');
    assert.equal(isoDate('nope'), null);
});

test('all prev rows carried forward + fresh current => catch-up since the carried date', () => {
    const prev = [row('ARKK', 'False', '2026-09-25'), row('ARKK', 'False', '2026-09-25'), row('AVUV', 'True', '2026-10-09')];
    const curr = [row('ARKK', 'True', '2026-10-10'), row('AVUV', 'True', '2026-10-12')];
    assert.deepEqual([...catchUpFunds(curr, prev)], [['ARKK', '2026-09-25']]);
});

test('one fresh prev row means the diff is a normal day', () => {
    const prev = [row('ARKK', 'False', '2026-09-25'), row('ARKK', 'True', '2026-10-09')];
    assert.equal(catchUpFunds([row('ARKK', 'True')], prev).size, 0);
});

test('files without the Refreshed column are unaffected', () => {
    assert.equal(catchUpFunds([row('ARKK', undefined)], [row('ARKK', undefined)]).size, 0);
});

test('a current row with a missing flag still counts as fresh (guarded)', () => {
    assert.equal(catchUpFunds([row('ARKK', undefined)], [row('ARKK', 'False', '2026-09-25')]).size, 1);
});

test('still carried forward today: no catch-up (nothing new to misread)', () => {
    assert.equal(catchUpFunds([row('ARKK', 'False')], [row('ARKK', 'False', '2026-09-25')]).size, 0);
});

test('fund absent from the current snapshot is not a catch-up', () => {
    assert.equal(catchUpFunds([row('AVUV', 'True')], [row('ARKK', 'False', '2026-09-25')]).size, 0);
});

test('since-date falls back to Date, picks the newest, and may be null', () => {
    const prev = [row('ARKK', 'False', undefined, '09/24/2026'), row('ARKK', 'False', '2026-09-25')];
    assert.equal(catchUpFunds([row('ARKK', 'True')], prev).get('ARKK'), '2026-09-25');
    assert.equal(catchUpFunds([row('ARKK', 'True')], [row('ARKK', 'False')]).get('ARKK'), null);
});

test('catchUpLabel names the since-date', async () => {
    const { catchUpLabel, shortDate } = await import('./catch-up.ts');
    assert.equal(shortDate('2026-09-25'), 'Sep 25');
    assert.equal(catchUpLabel('2026-09-25'), 'catch-up since Sep 25');
    assert.equal(catchUpLabel(''), 'catch-up');
    assert.equal(catchUpLabel(null), 'catch-up');
});
