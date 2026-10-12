import test from 'node:test';
import assert from 'node:assert/strict';
import { isCashName, isCashPlaceholder, isExcludedHolding } from './cash-name.ts';

test('real cash lines are still hidden from /holdings', () => {
    for (const [ticker, name] of [
        ['CASH', 'Cash & Other'], ['CASH&OTHER', 'CASH & OTHER'], ['USD', 'USD CASH'], ['', 'Cash Equivalent'],
        ['OTHER', 'Net Cash'], ['TBILL', 'United States Treasury Bill 10/15/2026'], ['912797UK1', 'United States Treasury Bill 10/15/2026'],
        ['CASH', 'CASH'], ['MARGIN', 'Margin balance'],
    ]) assert.equal(isExcludedHolding(ticker, name), true, `${ticker} ${name}`);
});

test('companies whose name merely contains "cash" stay in the book', () => {
    for (const [ticker, name] of [
        ['CSB', 'CASHBUILD LTD COMMON STOCK ZAR.01'], ['EUR', 'EUROCASH SA COMMON STOCK PLN1.0'], ['MTS', 'METCASH LTD COMMON STOCK'],
        ['FCFS', 'FirstCash Holdings, Inc.'], ['6418', 'JAPAN CASH MACHINE CO LTD COMMON STOCK'], ['LRE', 'LANCASHIRE HOLDINGS LTD COMMON STOCK USD.5'],
        ['CCV', 'CASH CONVERTERS INTERNATIONAL LTD'], ['TWE', 'TREASURY WINE ESTATES LTD COMMON STOCK'], ['BILL', 'BILL HOLDINGS INC COMMON STOCK USD.00001'],
    ]) assert.equal(isExcludedHolding(ticker, name), false, `${ticker} ${name}`);
});

test('Pathward Financial (a stock whose ticker is CASH) is not a cash placeholder', () => {
    assert.equal(isCashPlaceholder('CASH', 'PATHWARD FINANCIAL INC COMMON STOCK USD.01'), false);
    assert.equal(isExcludedHolding('CASH', 'PATHWARD FINANCIAL INC COMMON STOCK USD.01'), false);
    assert.equal(isCashPlaceholder('CASH', 'Cash & Other'), true);
});

test('CASH must be a whole word', () => {
    assert.equal(isCashName('CASH & OTHER'), true);
    assert.equal(isCashName('CASHFLOW SERVICES'), false);
    assert.equal(isCashName('CASHBUILD LTD COMMON STOCK'), false);
    assert.equal(isCashName('USD CASH'), true);
});
