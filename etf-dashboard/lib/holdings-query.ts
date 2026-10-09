import { getLatestHoldings, getDailyDiff, getLatestHoldingsDate } from '@/lib/holdings';

/**
 * Server-side query layer for /holdings. The page used to ship the entire
 * holdings book (20+ MB and growing nightly) to a client table, which blew
 * past Vercel's ISR body limit and was unusable on a phone. Now the server
 * filters, sorts and slices; the client only ever receives one page.
 */

export const HOLDINGS_COLUMNS = [
    'ETF Ticker', 'Ticker', 'Name', 'Option_Type', 'Share Quantity', 'sharesDelta',
    'Weight', 'weightDelta', 'Market Value', 'Option_Strike', 'Option_Expiry', 'DTE',
] as const;

export type HoldingsRow = Record<(typeof HOLDINGS_COLUMNS)[number], any>;

export interface HoldingsQuery {
    q: string;
    fund: string;
    type: 'ALL' | 'STOCK' | 'Call' | 'Put';
    sort: string;
    dir: 'asc' | 'desc';
    page: number;
    size: number;
}

export interface HoldingsResult {
    rows: HoldingsRow[];
    total: number;
    funds: string[];
    activeCount: number;
    changedCount: number;
    asOfDate: string | null;
    query: HoldingsQuery;
}

const PAGE_SIZES = [10, 20, 30, 40, 50, 100];
const EXCLUDED_TICKERS = new Set(['CASH', 'OTHER', '', 'USD', 'MARGIN', 'TBILL']);
const SORTABLE = new Set<string>(HOLDINGS_COLUMNS);
const TEXT_COLUMNS = new Set(['ETF Ticker', 'Ticker', 'Name', 'Option_Type', 'Option_Expiry']);

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function parseHoldingsQuery(params: Params): HoldingsQuery {
    const type = one(params.type);
    const sort = one(params.sort);
    const size = Number(one(params.size));
    const page = Math.floor(Number(one(params.page)));
    return {
        q: one(params.q).slice(0, 64),
        fund: one(params.fund).slice(0, 16),
        type: type === 'STOCK' || type === 'Call' || type === 'Put' ? type : 'ALL',
        sort: SORTABLE.has(sort) ? sort : '',
        dir: one(params.dir) === 'asc' ? 'asc' : 'desc',
        page: page > 0 ? page : 1,
        size: PAGE_SIZES.includes(size) ? size : 50,
    };
}

// The enriched book is the expensive part (CSV parse + two-day diff). Memoise
// per snapshot date so paging and sorting do not redo it on every request.
let memo: { date: string | null; book: Record<string, any>[]; changed: number } | null = null;

function loadBook() {
    const asOf = getLatestHoldingsDate();
    if (memo && memo.date === asOf) return memo;

    const data = getLatestHoldings();
    const diff = getDailyDiff();

    // "Δ Weight" is activeWeightDelta (price drift removed); sharesDelta is the
    // true share change. Same semantics the old page used.
    const changeMap = new Map<string, { weightDelta: number; sharesDelta: number }>();
    if (diff) {
        for (const c of [...diff.newPositions, ...diff.removedPositions, ...diff.changedPositions]) {
            changeMap.set(`${c.fund}|${c.ticker}`, {
                weightDelta: c.activeWeightDelta,
                sharesDelta: c.currentShares - c.previousShares,
            });
        }
    }

    const book: Record<string, any>[] = [];
    let changed = 0;
    for (const h of data) {
        const name = String(h.Name || '').toLowerCase();
        if (EXCLUDED_TICKERS.has(String(h.Ticker || '').toUpperCase())) continue;
        if (name.includes('cash') || name.includes('treasury bill')) continue;
        const change = changeMap.get(`${h['ETF Ticker']}|${h.Ticker}`);
        const weightDelta = change?.weightDelta ?? 0;
        if (weightDelta !== 0) changed++;
        const row: Record<string, any> = {};
        for (const k of HOLDINGS_COLUMNS) row[k] = (h as any)[k];
        row.weightDelta = weightDelta;
        row.sharesDelta = change?.sharesDelta ?? 0;
        book.push(row);
    }
    memo = { date: asOf, book, changed };
    return memo;
}

export function filterAndSort(q: HoldingsQuery): { rows: Record<string, any>[]; funds: string[]; activeCount: number; changedCount: number; asOfDate: string | null } {
    const { book, changed, date } = loadBook();
    const funds = Array.from(new Set(book.map(r => String(r['ETF Ticker'] ?? '')).filter(Boolean))).sort();
    const needle = q.q.trim().toLowerCase();

    let rows = book.filter(r => {
        if (q.fund && r['ETF Ticker'] !== q.fund) return false;
        const ot = String(r.Option_Type ?? '');
        if (q.type === 'STOCK' && ot) return false;
        if ((q.type === 'Call' || q.type === 'Put') && !ot.toLowerCase().startsWith(q.type[0].toLowerCase())) return false;
        if (needle) {
            return String(r.Ticker ?? '').toLowerCase().includes(needle) || String(r.Name ?? '').toLowerCase().includes(needle);
        }
        return true;
    });

    if (q.sort) {
        const m = q.dir === 'asc' ? 1 : -1;
        const text = TEXT_COLUMNS.has(q.sort);
        const key = q.sort;
        rows = [...rows].sort((a, b) => {
            if (text) return m * String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
            const av = Number(a[key]), bv = Number(b[key]);
            // Blanks (e.g. stock rows have no strike/DTE) always sink to the bottom.
            if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
            if (Number.isNaN(av)) return 1;
            if (Number.isNaN(bv)) return -1;
            return m * (av - bv);
        });
    }
    return { rows, funds, activeCount: book.length, changedCount: changed, asOfDate: date };
}

export function queryHoldings(q: HoldingsQuery): HoldingsResult {
    const { rows, funds, activeCount, changedCount, asOfDate } = filterAndSort(q);
    const pages = Math.max(1, Math.ceil(rows.length / q.size));
    const page = Math.min(q.page, pages);
    const start = (page - 1) * q.size;
    return {
        rows: rows.slice(start, start + q.size) as HoldingsRow[],
        total: rows.length,
        funds, activeCount, changedCount, asOfDate,
        query: { ...q, page },
    };
}
