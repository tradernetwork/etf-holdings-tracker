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
export function getAvailableHistoryDates(): string[] {
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
import { holdingKey, activeWeightDeltas } from './active-weight';

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


