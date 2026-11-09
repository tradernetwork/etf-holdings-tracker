import type { Holding } from './holdings';


/**
 * Composite key: fund + ticker + option expiry + option strike.
 * This correctly differentiates two options on the same underlying
 * with different strikes or expiries.
 */
export function holdingKey(h: Holding): string {
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

// Implied price ratio bounds outside which a non-split move is treated as unmodelable
// (mirrors _MIN/_MAX_PLAUSIBLE_PRICE_RATIO in api/data.py).
const MIN_PLAUSIBLE_PRICE_RATIO = 0.2;
const MAX_PLAUSIBLE_PRICE_RATIO = 5.0;

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
export function activeWeightDeltas(current: Holding[], previous: Holding[]): Map<string, number> {
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
    const unreliable = new Set<string>();
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
                    const priceRatio = cPrice / pPrice;
                    if (split === 1 && !(MIN_PLAUSIBLE_PRICE_RATIO <= priceRatio && priceRatio <= MAX_PLAUSIBLE_PRICE_RATIO)) {
                        // Implied price (value / shares) moved >5x overnight and it
                        // is not a recognised split: a corporate action or provider
                        // restatement we can't model. Treat as no drift and report 0
                        // below (mirrors api/data.py).
                        unreliable.add(k);
                    } else {
                        ratio = priceRatio * split;
                    }
                }
            }
            ratios.set(k, ratio);
            denom += (p.Weight || 0) * ratio;
        }
        if (denom <= 0) return;
        for (const k of keys) {
            const drift = (prevMap.get(k)!.Weight || 0) * ratios.get(k)! / denom * prevSum;
            const currWeight = currMap.get(k)?.Weight ?? 0;
            active.set(k, unreliable.has(k) ? 0 : currWeight - drift);
        }
    });

    // A position with no previous snapshot has no drift to subtract — all of it
    // is a decision the manager made today.
    currMap.forEach((h, key) => {
        if (!prevMap.has(key)) active.set(key, h.Weight || 0);
    });

    return active;
}
