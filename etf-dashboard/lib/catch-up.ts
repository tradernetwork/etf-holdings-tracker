/**
 * Catch-up detection for the day-over-day diff. Mirrors `_catch_up_funds` in
 * api/data.py (keep the two in lockstep).
 *
 * A fund the scraper could not fetch is carried forward day after day with
 * `Refreshed=False`. When its issuer file comes back, diffing against the
 * carried rows yields the whole gap's trading (ARK: 2026-09-25 -> 2026-10-12),
 * not one day's. Such a fund must not be shown as having "changed today".
 *
 * Rule (identical to the API): a fund is a catch-up when ALL of its previous
 * rows are Refreshed=False, the fund is present in the current snapshot, and
 * the current rows are NOT all Refreshed=False. Files written before the
 * Refreshed column existed give `null` flags, so they are never affected; a
 * current row with a missing flag counts as "not False", i.e. guarded.
 *
 * Deliberately dependency-free so it can be unit tested with `node --test`.
 */

export interface ProvenanceRow {
    'ETF Ticker': string;
    Refreshed?: unknown;
    Source_Date?: unknown;
    Date?: unknown;
}

/** false when the scraper carried the row forward; null when unknown (older files). */
export function rowRefreshed(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    const s = String(v ?? '').trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return null;
}

/** '2026-08-14', '08/14/2026' or '2026-08-14 00:00:00' -> '2026-08-14'. */
export function isoDate(v: unknown): string | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[0];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return null;
}

/** The date a row's data is really from: Source_Date, else the issuer's own Date column. */
export function rowFileDate(r: ProvenanceRow): string | null {
    return isoDate(r.Source_Date) ?? isoDate(r.Date);
}

/** fund -> the last real disclosure date the carried rows are from (null if unknown). */
export function catchUpFunds(current: ProvenanceRow[], previous: ProvenanceRow[]): Map<string, string | null> {
    const prevFlags = new Map<string, (boolean | null)[]>();
    const prevDates = new Map<string, string[]>();
    for (const r of previous) {
        const f = r['ETF Ticker'];
        (prevFlags.get(f) ?? prevFlags.set(f, []).get(f)!).push(rowRefreshed(r.Refreshed));
        const d = rowFileDate(r);
        if (d) (prevDates.get(f) ?? prevDates.set(f, []).get(f)!).push(d);
    }
    const currFlags = new Map<string, (boolean | null)[]>();
    for (const r of current) {
        const f = r['ETF Ticker'];
        (currFlags.get(f) ?? currFlags.set(f, []).get(f)!).push(rowRefreshed(r.Refreshed));
    }
    const out = new Map<string, string | null>();
    prevFlags.forEach((flags, fund) => {
        const cur = currFlags.get(fund);
        if (flags.every(f => f === false) && cur && !cur.every(f => f === false)) {
            const dates = prevDates.get(fund) ?? [];
            out.set(fund, dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null);
        }
    });
    return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-25' -> 'Sep 25' (parsed by hand: no timezone surprises). */
export function shortDate(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : '';
}

/** "catch-up since Sep 25" (or just "catch-up" when the carried date is unknown). */
export function catchUpLabel(since: string | null | undefined): string {
    const d = shortDate(since);
    return d ? `catch-up since ${d}` : 'catch-up';
}
