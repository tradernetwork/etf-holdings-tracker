/**
 * What time span a Δ covers, in plain words. The API says which earlier snapshot the deltas are measured against
 * (`previousDate`, and `comparisonTradingDays` sessions between it and `asOfDate`); this turns that into a label.
 * Pure, with no app imports so node:test can load it. Mirrors mobile/lib/deltaPeriod.ts (same wording).
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri Oct 9" from an ISO date (calendar arithmetic in UTC, no timezone drift); "" when unparseable. */
export function weekdayDay(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return `${DAYS[d.getUTCDay()]} ${MONTHS[+m[2] - 1]} ${+m[3]}`;
}

function shortDay(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : '';
}

export interface DeltaSpanInput {
    previousDate?: string | null;
    comparisonTradingDays?: number | null;
    /** A fund whose latest disclosure is older than the snapshot: nothing new to compare. */
    stale?: boolean;
    holdingsDate?: string | null;
    /** A fund returning from carried-forward rows: its daily deltas are withheld. */
    catchUp?: boolean;
    catchUpSince?: string | null;
}

/**
 * The span, without the noun: "vs Fri Oct 9", "vs Wed Oct 7 (3 trading days)", "since Sep 25, not daily moves",
 * "no new disclosure since Sep 25". null when the API did not say (older server) and nothing else applies.
 */
export function deltaSpan(s: DeltaSpanInput): string | null {
    if (s.catchUp) return `since ${shortDay(s.catchUpSince) || 'an earlier file'}, not daily moves`;
    if (s.stale) return `no new disclosure since ${shortDay(s.holdingsDate) || 'an earlier date'}`;
    const prev = weekdayDay(s.previousDate);
    if (!prev) return null;
    const n = s.comparisonTradingDays;
    return n != null && n > 1 ? `vs ${prev} (${n} trading days)` : `vs ${prev}`;
}

/** "Δ shares · vs Fri Oct 9": the label that sits next to a Δ column or heading. */
export function deltaLabel(noun: string, s: DeltaSpanInput): string | null {
    const span = deltaSpan(s);
    return span ? `${noun} · ${span}` : null;
}
