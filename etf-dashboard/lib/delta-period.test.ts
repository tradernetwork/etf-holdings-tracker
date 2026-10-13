import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaLabel, deltaSpan, weekdayDay } from './delta-period.ts';

test('names the weekday and date the delta is measured against', () => {
    assert.equal(weekdayDay('2026-10-09'), 'Fri Oct 9');
    assert.equal(weekdayDay('2026-10-12'), 'Mon Oct 12');
    assert.equal(weekdayDay(null), '');
});

test('one trading day is just "vs <date>"; more is said out loud', () => {
    assert.equal(deltaSpan({ previousDate: '2026-10-09', comparisonTradingDays: 1 }), 'vs Fri Oct 9');
    assert.equal(deltaSpan({ previousDate: '2026-10-07', comparisonTradingDays: 3 }), 'vs Wed Oct 7 (3 trading days)');
    assert.equal(deltaLabel('Δ shares', { previousDate: '2026-10-09', comparisonTradingDays: 1 }), 'Δ shares · vs Fri Oct 9');
});

test('catch-up and stale funds keep their own wording', () => {
    assert.equal(deltaSpan({ catchUp: true, catchUpSince: '2026-09-25', previousDate: '2026-10-09' }), 'since Sep 25, not daily moves');
    assert.equal(deltaSpan({ stale: true, holdingsDate: '2026-09-25', previousDate: '2026-10-09' }), 'no new disclosure since Sep 25');
});

test('says nothing when the API did not', () => {
    assert.equal(deltaSpan({}), null);
    assert.equal(deltaLabel('Δ', {}), null);
});
