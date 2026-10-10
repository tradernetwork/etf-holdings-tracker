/**
 * Historically this file mirrored api/data.py's whole signal surface for the
 * dashboard. That surface is now served entirely by the FastAPI backend via
 * @/lib/api (see app/dashboard/page.tsx, app/changes/page.tsx,
 * app/fund/[ticker]/page.tsx, app/api/signals/route.ts) — api/data.py is the
 * ONLY signal implementation. The cross-fund aggregate functions that used to
 * live here (institutional signals, buying/selling, streaks, sector flow,
 * divergences, ticker/fund detail, pre-market briefing) were deleted on
 * 2026-09-03 because nothing imported them; they had already silently
 * diverged from the Python they claimed to mirror (see git history for the
 * removed code if you need to resurrect any of it).
 *
 * What remains is genuinely load-bearing:
 *   - PROVIDER_ORDER, FUND_AUM — static reference data re-exported from
 *     lib/providers.ts for a few pages' table grouping / last-resort AUM
 *     fallback. AUM itself is now served by the API (api/data.py's
 *     get_fund_aum(), added to /api/v1/fund/{t}, /api/v1/ticker/{t}, and
 *     signal fundDetails) — the per-fund-derived getFundAum() that used to
 *     live here was deleted 2026-09-03 because it read history CSVs at
 *     Vercel build time, which could disagree with the live API's figures.
 *     Prefer the API's `aum` field; fall back to the static FUND_AUM table
 *     only when a fund is missing from the response.
 *   - getLatestHoldings, getDailyDiff, getLatestHoldingsDate — used by
 *     app/holdings/page.tsx, which needs raw CSV-shaped rows with
 *     Option_Type, Option_Strike, DTE, etc. that the public API doesn't
 *     expose. Migrating that page would require either reshaping
 *     /api/v1/holdings or rewriting the columns.
 *
 * Active weight (2026-07-30): getDailyDiff's `activeWeightDelta` (price drift
 * removed) is what /holdings' Δ Weight column renders — `activeWeightDeltas`/
 * `splitFactor`/`rowPrice` below are a faithful port of api/data.py's
 * `_active_weight_deltas`/`_split_factor`/`_row_price`, verified
 * position-for-position against it. Raw `weightDelta` is retained on every
 * record for transparency but must NOT be substituted for the active value —
 * see api/data.py's methodology note. Keep the two implementations in
 * lockstep if you touch either.
 */

import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { isTradingDay } from './marketHours';
import { catchUpFunds } from './catch-up';

export interface Holding {
    Date: string;
    'ETF Ticker': string;
    Name: string;
    Ticker: string;
    Weight: number;
    'Share Quantity': number;
    'Market Value': number;
    NetAssets?: number;
    Underlying_Ticker?: string;
    Option_Strike?: number;
    Option_Expiry?: string;
    Option_Type?: string;
    DTE?: number;
    Underlying_Price?: number;
    Moneyness?: number;
    Sector?: string;
    Country?: string;
    /** false = carried forward by the scraper (issuer fetch failed); absent in older files. */
    Refreshed?: boolean | string | null;
    /** The date the row's data is really from. */
    Source_Date?: string;
}

export type ChangeType = 'NEW' | 'REMOVED' | 'CHANGED';

export interface ChangeRecord {
    type: ChangeType;
    fund: string;
    ticker: string;
    name: string;
    currentWeight: number;
    previousWeight: number;
    weightDelta: number;
    /** Manager-attributable weight change, price drift removed (see
     *  activeWeightDeltas). Direction/significance/sort key off THIS, not the
     *  raw weightDelta — a holding's raw weight moves on price alone. */
    activeWeightDelta: number;
    currentShares: number;
    previousShares: number;
    isOption: boolean;
    optionDetails?: {
        type: string;
        strike: number;
        expiry: string;
    };
}

export interface HoldingsDiff {
    newPositions: ChangeRecord[];
    removedPositions: ChangeRecord[];
    changedPositions: ChangeRecord[];
    /**
     * Funds whose previous rows were all carried forward while today's are fresh:
     * their day-over-day diff would be a multi-week catch-up, so they are left
     * OUT of the lists above. fund -> last real disclosure date (the "since" date).
     * Mirrors `_catch_up_funds` in api/data.py.
     */
    catchUpFunds: Record<string, string | null>;
}

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

// Static provider map — update when adding new funds to scrape_avantis.py
// Pure-data reference (provider map, AUM, ordering) lives in lib/providers.ts
// so client components can import it without pulling in this file's `fs`
// dependency. EXCLUDED_FUNDS is used internally below; PROVIDER_ORDER and
// FUND_AUM are re-exported for back-compat with existing server-side imports
// of `lib/holdings` (app/dashboard, app/changes, app/fund/[ticker],
// app/equity). FUND_PROVIDERS and getProvider are NOT re-exported — every
// consumer imports them directly from lib/providers.ts.
import { PROVIDER_ORDER, EXCLUDED_FUNDS, FUND_AUM } from './providers';
export { PROVIDER_ORDER, EXCLUDED_FUNDS, FUND_AUM };

// ─── History file helpers ───────────────────────────────────────────────────

/**
 * Returns all available history dates (sorted descending, newest first).
 * Scans for files matching `holdings_YYYY-MM-DD.csv` in the history dir.
 */
function getAvailableHistoryDates(): string[] {
    if (!fs.existsSync(HISTORY_DIR)) return [];
    return fs
        .readdirSync(HISTORY_DIR)
        .map(f => f.match(/^holdings_(\d{4}-\d{2}-\d{2})\.csv$/)?.[1])
        .filter((d): d is string => !!d)
        .filter(isTradingDay) // drop weekend/holiday snapshots — count trading days only
        .sort()   // lexicographic sort works for ISO dates
        .reverse(); // newest first
}

function readHoldingsCsv(filePath: string): Holding[] {
    if (!fs.existsSync(filePath)) return [];
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data } = Papa.parse<Holding>(fileContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
    });
    // Filter out junk rows (e.g., iShares disclaimer text rows that sneak through)
    return (data as Holding[]).filter(
        h => h['ETF Ticker'] && h.Ticker && typeof h.Weight === 'number'
    );
}

/**
 * Returns the latest holdings snapshot.
 * Prefers the newest file in data/history/; falls back to holdings_latest.csv.
 */
export function getLatestHoldings(): Holding[] {
    const dates = getAvailableHistoryDates();
    let data: Holding[] = [];
    if (dates.length > 0) {
        const newestPath = path.join(HISTORY_DIR, `holdings_${dates[0]}.csv`);
        data = readHoldingsCsv(newestPath);
    }
    if (data.length === 0) {
        const latestPath = path.join(DATA_DIR, 'holdings_latest.csv');
        data = readHoldingsCsv(latestPath);
    }
    return data.filter(h => !EXCLUDED_FUNDS.has(h['ETF Ticker']));
}

/** Returns the ISO date string (YYYY-MM-DD) of the latest holdings snapshot, or null. */
export function getLatestHoldingsDate(): string | null {
    return getAvailableHistoryDates()[0] ?? null;
}

/**
 * Returns holdings for a specific date string (YYYY-MM-DD).
 * Used for the weekly diff.
 */
export function getHistoricalHoldings(dateStr: string): Holding[] {
    const historyPath = path.join(HISTORY_DIR, `holdings_${dateStr}.csv`);
    return readHoldingsCsv(historyPath).filter(h => !EXCLUDED_FUNDS.has(h['ETF Ticker']));
}

// ─── Diff logic ───────────────────────────────────────────────────────────

/**
 * Composite key: fund + ticker + option expiry + option strike.
 * This correctly differentiates two options on the same underlying
 * with different strikes or expiries.
 */
function holdingKey(h: Holding): string {
    return [
        h['ETF Ticker'] ?? '',
        h.Ticker ?? '',
        h.Option_Expiry ?? '',
        h.Option_Strike != null ? String(h.Option_Strike) : '',
    ].join('|');
}

// ─── Active weight (price drift removed) ────────────────────────────────────
// Ported from api/data.py's _active_weight_deltas / _split_factor / _row_price
// — keep in sync with that file. A holding's RAW weight moves whenever its
// price moves, even if nobody trades a share; active weight subtracts each
// position's price-only drift (renormalized across the fund's whole book), so
// what's left is the manager's actual reallocation. On real trades this lifts
// direction accuracy from ~59% to ~81%; raw weight agreed with the true share
// change only ~49% of the time. Everything downstream keys off active weight.

/**
 * Per-unit price for a row: Market Value / Shares, falling back to a Price
 * column, else 0 ("price unknown" → assume no drift rather than invent a return).
 */
function rowPrice(h: Holding): number {
    const shares = h['Share Quantity'] || 0;
    const mv = h['Market Value'] || 0;
    if (shares && mv) return mv / shares;
    const p = (h as { Price?: number }).Price;
    return typeof p === 'number' && isFinite(p) ? p : 0;
}

// Share ratios a split can plausibly produce (k:1 and 1:k). A split multiplies
// shares by k and divides price by k, leaving the position's VALUE untouched —
// which is how we tell it apart from a trade.
const SPLIT_FACTORS: number[] = (() => {
    const base = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 20];
    return [...base, ...base.map(k => 1 / k)];
})();

/**
 * Detect a stock / reverse split between two snapshots. 1.0 = none. A split
 * preserves value (share_ratio * price_ratio ≈ 1); a real trade does not.
 * Without this a 4:1 split reads as a huge phantom buy that (active weight
 * being zero-sum within a fund) manufactures false sell signals on every
 * untouched holding.
 */
function splitFactor(prevShares: number, currShares: number, prevPrice: number, currPrice: number): number {
    if (prevShares <= 0 || currShares <= 0 || prevPrice <= 0 || currPrice <= 0) return 1;
    const shareRatio = currShares / prevShares;
    const priceRatio = currPrice / prevPrice;
    for (const k of SPLIT_FACTORS) {
        if (Math.abs(shareRatio / k - 1) < 0.02 && Math.abs(priceRatio * k - 1) < 0.15) return k;
    }
    return 1;
}

/**
 * Manager-attributable weight change per position, price drift removed.
 * Keyed by holdingKey(). Mirrors api/data.py:_active_weight_deltas:
 *
 *     drift_i  = w_prev_i * ratio_i / Σ_j(w_prev_j * ratio_j) * Σ w_prev
 *     active_i = w_curr_i - drift_i
 *
 * Renormalizing the drift over the previous snapshot's total cancels price
 * moves AND creation/redemption flow in one step: a pro-rata inflow leaves
 * every weight unchanged, so every active_i ≈ 0 (Σ active_i ≈ 0 per fund).
 * Options/cash are INCLUDED in the denominator — weights sum to 100 across the
 * whole book. A position absent from `previous` is entirely active (a brand-new
 * position is 100% a decision). Funds with no usable previous weights are
 * omitted, and callers fall back to the raw delta for those keys.
 */
function activeWeightDeltas(current: Holding[], previous: Holding[]): Map<string, number> {
    const currMap = new Map<string, Holding>();
    const prevMap = new Map<string, Holding>();
    current.forEach(h => currMap.set(holdingKey(h), h));
    previous.forEach(h => prevMap.set(holdingKey(h), h));

    // Group previous keys by fund so each renormalization sees the whole book.
    const prevByFund = new Map<string, string[]>();
    prevMap.forEach((h, key) => {
        const fund = h['ETF Ticker'];
        const arr = prevByFund.get(fund);
        if (arr) arr.push(key); else prevByFund.set(fund, [key]);
    });

    const active = new Map<string, number>();
    prevByFund.forEach(keys => {
        const prevSum = keys.reduce((s, k) => s + (prevMap.get(k)!.Weight || 0), 0);
        if (prevSum <= 0) return; // nothing to renormalize against — use raw delta
        const ratios = new Map<string, number>();
        let denom = 0;
        for (const k of keys) {
            const p = prevMap.get(k)!;
            const c = currMap.get(k);
            // Price unknown on either side (or a removed row) → assume no drift.
            let ratio = 1;
            const pPrice = rowPrice(p);
            if (c) {
                const cPrice = rowPrice(c);
                if (pPrice > 0 && cPrice > 0) {
                    const split = splitFactor(p['Share Quantity'] || 0, c['Share Quantity'] || 0, pPrice, cPrice);
                    ratio = (cPrice / pPrice) * split;
                }
            }
            ratios.set(k, ratio);
            denom += (p.Weight || 0) * ratio;
        }
        if (denom <= 0) return;
        for (const k of keys) {
            const drift = (prevMap.get(k)!.Weight || 0) * ratios.get(k)! / denom * prevSum;
            const currWeight = currMap.get(k)?.Weight ?? 0;
            active.set(k, currWeight - drift);
        }
    });

    // A position with no previous snapshot has no drift to subtract — all of it
    // is a decision the manager made today.
    currMap.forEach((h, key) => {
        if (!prevMap.has(key)) active.set(key, h.Weight || 0);
    });

    return active;
}

function computeDiff(currentAll: Holding[], previousAll: Holding[]): HoldingsDiff | null {
    if (!previousAll || previousAll.length === 0) return null;

    // A fund coming back from carried-forward rows would report its whole gap as
    // one day's trades. Drop it from BOTH sides before anything is computed
    // (including the per-fund renormalization in activeWeightDeltas), exactly as
    // api/data.py does, and report it separately so the UI can say why.
    const catchUp = catchUpFunds(currentAll, previousAll);
    const current = catchUp.size ? currentAll.filter(h => !catchUp.has(h['ETF Ticker'])) : currentAll;
    const previous = catchUp.size ? previousAll.filter(h => !catchUp.has(h['ETF Ticker'])) : previousAll;

    const currentMap = new Map<string, Holding>();
    const previousMap = new Map<string, Holding>();

    current.forEach(h => currentMap.set(holdingKey(h), h));
    previous.forEach(h => previousMap.set(holdingKey(h), h));

    // Active weight per position (price drift removed), computed over the FULL
    // book (options + cash) before any filtering, so per-fund renormalization
    // sees all 100%. Records fall back to the raw delta where a key is absent.
    const active = activeWeightDeltas(current, previous);

    const newPositions: ChangeRecord[] = [];
    const removedPositions: ChangeRecord[] = [];
    const changedPositions: ChangeRecord[] = [];

    // Check for NEW and CHANGED
    currentMap.forEach((curr, key) => {
        const prev = previousMap.get(key);
        const isOption = !!curr.Option_Type;
        const optionDetails = isOption ? {
            type: curr.Option_Type!,
            strike: curr.Option_Strike!,
            expiry: curr.Option_Expiry!
        } : undefined;

        if (!prev) {
            newPositions.push({
                type: 'NEW',
                fund: curr['ETF Ticker'],
                ticker: curr.Ticker,
                name: curr.Name,
                currentWeight: curr.Weight || 0,
                previousWeight: 0,
                weightDelta: curr.Weight || 0,
                activeWeightDelta: active.get(key) ?? (curr.Weight || 0),
                currentShares: curr['Share Quantity'] || 0,
                previousShares: 0,
                isOption,
                optionDetails
            });
        } else {
            const weightDelta = (curr.Weight || 0) - (prev.Weight || 0);
            const sharesChanged = (curr['Share Quantity'] || 0) !== (prev['Share Quantity'] || 0);

            // Bug 4 fix: lowered threshold from 0.1 to 0.01 (1 basis point)
            // so small-weight rebalances are not silently dropped. Gate on a
            // real share move OR raw-weight move so price-only drift alone does
            // not manufacture a "change" row — active weight is what's shown.
            if (Math.abs(weightDelta) > 0.01 || sharesChanged) {
                changedPositions.push({
                    type: 'CHANGED',
                    fund: curr['ETF Ticker'],
                    ticker: curr.Ticker,
                    name: curr.Name,
                    currentWeight: curr.Weight || 0,
                    previousWeight: prev.Weight || 0,
                    weightDelta: weightDelta,
                    activeWeightDelta: active.get(key) ?? weightDelta,
                    currentShares: curr['Share Quantity'] || 0,
                    previousShares: prev['Share Quantity'] || 0,
                    isOption,
                    optionDetails
                });
            }
        }
    });

    // Check for REMOVED
    previousMap.forEach((prev, key) => {
        if (!currentMap.has(key)) {
            const isOption = !!prev.Option_Type;
            const optionDetails = isOption ? {
                type: prev.Option_Type!,
                strike: prev.Option_Strike!,
                expiry: prev.Option_Expiry!
            } : undefined;

            removedPositions.push({
                type: 'REMOVED',
                fund: prev['ETF Ticker'],
                ticker: prev.Ticker,
                name: prev.Name,
                currentWeight: 0,
                previousWeight: prev.Weight || 0,
                weightDelta: -(prev.Weight || 0),
                activeWeightDelta: active.get(key) ?? -(prev.Weight || 0),
                currentShares: 0,
                previousShares: prev['Share Quantity'] || 0,
                isOption,
                optionDetails
            });
        }
    });

    // Sort by absolute ACTIVE weight delta descending (price drift removed).
    newPositions.sort((a, b) => Math.abs(b.activeWeightDelta) - Math.abs(a.activeWeightDelta));
    removedPositions.sort((a, b) => Math.abs(b.activeWeightDelta) - Math.abs(a.activeWeightDelta));
    changedPositions.sort((a, b) => Math.abs(b.activeWeightDelta) - Math.abs(a.activeWeightDelta));

    return { newPositions, removedPositions, changedPositions, catchUpFunds: Object.fromEntries(catchUp) };
}

// ─── Public diff API ─────────────────────────────────────────────────────────

/**
 * Compares the two most-recent history snapshots (daily diff).
 * Falls back to holdings_latest.csv when only one history file exists.
 */
export function getDailyDiff(): HoldingsDiff | null {
    const dates = getAvailableHistoryDates();
    const current = getLatestHoldings();
    if (current.length === 0) return null;

    // If we have ≥2 history files, use index [1] as previous (second-newest)
    if (dates.length >= 2) {
        const previous = getHistoricalHoldings(dates[1]);
        return computeDiff(current, previous);
    }

    // If only 1 history file, try holdings_latest.csv as previous
    const latestPath = path.join(DATA_DIR, 'holdings_latest.csv');
    if (fs.existsSync(latestPath)) {
        const previous = readHoldingsCsv(latestPath);
        if (previous.length > 0) return computeDiff(current, previous);
    }

    return null;
}


