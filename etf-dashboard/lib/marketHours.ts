/**
 * Market-hours helpers — MWF 0DTE expiration awareness.
 * Ported from TraderMatrix for the CBOE Options Scanner page.
 */

// NYSE market holidays (YYYY-MM-DD in ET). Update annually.
export const NYSE_HOLIDAYS = new Set([
    // 2026
    "2026-01-01", // New Year's Day
    "2026-01-19", // Martin Luther King Jr. Day
    "2026-02-16", // Presidents' Day
    "2026-04-03", // Good Friday
    "2026-05-25", // Memorial Day
    "2026-06-19", // Juneteenth
    "2026-07-03", // Independence Day (observed)
    "2026-09-07", // Labor Day
    "2026-11-26", // Thanksgiving Day
    "2026-12-25", // Christmas Day
    // 2027
    "2027-01-01", // New Year's Day
    "2027-01-18", // Martin Luther King Jr. Day
    "2027-02-15", // Presidents' Day
    "2027-03-26", // Good Friday
    "2027-05-31", // Memorial Day
    "2027-06-18", // Juneteenth (observed, falls on Friday)
    "2027-07-05", // Independence Day (observed, falls on Monday)
    "2027-09-06", // Labor Day
    "2027-11-25", // Thanksgiving Day
    "2027-12-24", // Christmas Day (observed, falls on Friday)
]);

/**
 * True if `iso` ('YYYY-MM-DD') is a weekday and not an NYSE holiday.
 * Used to filter non-market-day history snapshots out of streak / lookback math.
 */
/**
 * Trading days in (previous, asOf]: 1 for consecutive sessions, more across a holiday or a missed scrape (the skipped
 * session is still a trading day the delta spans). Mirrors api/data.py trading_days_between. null when either date is unknown.
 */
export function tradingDaysBetween(previous: string | null | undefined, asOf: string | null | undefined): number | null {
    const ok = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!ok(previous) || !ok(asOf) || asOf <= previous) return null;
    let n = 0;
    const d = new Date(`${previous}T00:00:00Z`);
    const end = new Date(`${asOf}T00:00:00Z`);
    while (d < end) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (isTradingDay(d.toISOString().slice(0, 10))) n++;
    }
    return n;
}

export function isTradingDay(iso: string): boolean {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return true; // unparseable — let downstream handle
    // Construct as UTC to avoid TZ shifting the weekday.
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun ... 6=Sat
    return dow !== 0 && dow !== 6 && !NYSE_HOLIDAYS.has(iso);
}

/**
 * The 12 tickers (excluding SPY/QQQ) approved for Monday/Wednesday/Friday
 * weekly option expirations. SPY and QQQ are excluded because they're
 * already featured prominently across the site.
 */
export const MWF_TICKERS = [
    "GLD", "IBIT", "SLV", "TLT",
    "AAPL", "AMZN", "AVGO", "GOOGL",
    "META", "MSFT", "NVDA", "TSLA",
] as const;

export type MWFTicker = (typeof MWF_TICKERS)[number];

/**
 * Check if today (in ET) is a Monday, Wednesday, or Friday — the days when
 * the MWF tickers have 0DTE option expirations. NYSE holidays are excluded.
 * Also returns the next upcoming MWF expiration day.
 */
export function getMWFExpirationStatus(): {
    isExpirationDay: boolean;
    dayName: string;
    nextExpirationDay: string;
} {
    const etTime = new Date(
        new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    );
    const day = etTime.getDay(); // 0=Sun, 1=Mon ... 6=Sat

    const dayNames = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ];
    const dayName = dayNames[day];

    const year = etTime.getFullYear();
    const month = String(etTime.getMonth() + 1).padStart(2, "0");
    const date = String(etTime.getDate()).padStart(2, "0");
    const isHoliday = NYSE_HOLIDAYS.has(`${year}-${month}-${date}`);

    const isMWF = (day === 1 || day === 3 || day === 5) && !isHoliday;

    // Next MWF expiration day — skip holidays
    const nextCandidate = new Date(etTime);
    let nextExpirationDay = "Monday";
    for (let i = 1; i <= 14; i++) {
        nextCandidate.setDate(nextCandidate.getDate() + 1);
        const nd = nextCandidate.getDay();
        if (nd !== 1 && nd !== 3 && nd !== 5) continue;
        const ny = nextCandidate.getFullYear();
        const nm = String(nextCandidate.getMonth() + 1).padStart(2, "0");
        const ndate = String(nextCandidate.getDate()).padStart(2, "0");
        if (!NYSE_HOLIDAYS.has(`${ny}-${nm}-${ndate}`)) {
            nextExpirationDay = dayNames[nd];
            break;
        }
    }

    return { isExpirationDay: isMWF, dayName, nextExpirationDay };
}
