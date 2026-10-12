/**
 * recap-email.test.ts — Runnable self-check for renderRecapEmail().
 *
 * Uses Node's built-in test runner (node:test / node:assert).
 * Run with:
 *   npx tsx --test etf-dashboard/lib/recap-email.test.ts
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderRecapEmail, TM_REF_URL, type RecapEmailInput } from './recap-email.ts';

const SAMPLE: RecapEmailInput = {
    weekLabel: 'WEEK OF OCT 6 – 10',
    headline: 'Institutions piled into chips. They kept selling Tesla.',
    rows: [
        { ticker: 'NVDA', name: 'NVIDIA Corp', detail: '9 funds · 3 families', delta: '+0.62% wk', up: true },
        { ticker: 'HOOD', name: 'Robinhood Markets', detail: 'new layering · 4 funds', delta: '+0.94% wk', up: true },
        { ticker: 'TSM', name: 'Taiwan Semiconductor', detail: 'DRAM + CGGO + ARKK', delta: '+0.52% wk', up: true },
        { ticker: 'TSLA', name: 'Tesla Inc', detail: 'ARKK, ARKQ trimming', delta: '−1.31% wk', up: false },
    ],
    newLayering: [
        { ticker: 'HOOD', families: 3, days: 5 },
        { ticker: 'TSM', families: 3, days: 7 },
    ],
};

test('renderRecapEmail returns all three keys', () => {
    const out = renderRecapEmail(SAMPLE);
    assert.ok(out.subject, 'subject must be non-empty');
    assert.ok(out.html, 'html must be non-empty');
    assert.ok(out.text, 'text must be non-empty');
});

test('html contains the referral URL', () => {
    const { html } = renderRecapEmail(SAMPLE);
    assert.ok(
        html.includes(TM_REF_URL),
        `html must include the ref URL "${TM_REF_URL}"`,
    );
});

test('text contains the referral URL', () => {
    const { text } = renderRecapEmail(SAMPLE);
    assert.ok(
        text.includes(TM_REF_URL),
        `plain text must include the ref URL "${TM_REF_URL}"`,
    );
});

test('ref code never appears without the full domain', () => {
    // ?ref=MPHINANCE must always be part of the full tradermatrix.pro URL
    for (const chunk of [renderRecapEmail(SAMPLE).html, renderRecapEmail(SAMPLE).text]) {
        const all = (chunk.match(/\?ref=MPHINANCE/g) ?? []).length;
        const full = (chunk.match(/tradermatrix\.pro\/\?ref=MPHINANCE/g) ?? []).length;
        assert.equal(all, full, '?ref=MPHINANCE must only appear within the full tradermatrix.pro URL');
    }
});

test('html contains the headline text', () => {
    const { html } = renderRecapEmail(SAMPLE);
    assert.ok(html.includes('piled into chips'), 'headline must appear in html');
});

test('html contains all ticker symbols', () => {
    const { html } = renderRecapEmail(SAMPLE);
    for (const row of SAMPLE.rows) {
        assert.ok(html.includes(row.ticker), `html must contain ticker ${row.ticker}`);
    }
});

test('subject contains the headline', () => {
    const { subject } = renderRecapEmail(SAMPLE);
    assert.ok(subject.includes('piled into chips'), 'subject must echo the headline');
});

test('layering entries appear in both html and text', () => {
    const { html, text } = renderRecapEmail(SAMPLE);
    assert.ok(html.includes('HOOD'), 'html layering section must name HOOD');
    assert.ok(text.includes('HOOD'), 'plain text layering must name HOOD');
});

test('unsubscribe footer present in both outputs', () => {
    const { html, text } = renderRecapEmail(SAMPLE);
    assert.ok(html.toLowerCase().includes('unsubscribe'), 'html must include unsubscribe');
    assert.ok(text.toLowerCase().includes('unsubscribe'), 'text must include unsubscribe');
});

test('html is well-formed: doctype + body closing tags present', () => {
    const { html } = renderRecapEmail(SAMPLE);
    assert.ok(html.startsWith('<!doctype html>'), 'must start with doctype');
    assert.ok(html.includes('</body>'), 'must include closing body tag');
    assert.ok(html.includes('</html>'), 'must include closing html tag');
});
