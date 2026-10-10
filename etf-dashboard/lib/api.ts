/**
 * Typed client for the TickerTrace public API (FastAPI on Vultr).
 *
 * As of review #10 (May 2026 finale) the FastAPI server is feature-complete
 * for the dashboard: briefing, activity, streaks, and enriched signals all
 * live on the API side. This client mirrors those response shapes 1:1 so the
 * Next.js dashboard can render directly from the API without holdings.ts.
 *
 * Base URL: NEXT_PUBLIC_API_URL or api.tickertrace.pro.
 * Inside the Next.js app, /api/v1/* also works via the rewrite in next.config.ts.
 */

export const API_BASE =
    process.env.NEXT_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

// ─── Shared row types ───────────────────────────────────────────────────────

export type ChangeType = "NEW" | "REMOVED" | "CHANGED";

/**
 * Fund family type. `active-equity` funds (Avantis, ARK, Corgi, Sprott) pick
 * stocks — the signal is conviction over a week/month. `option-income` funds
 * (YieldMax, Kurv, REX, Roundhill, NestYield, NicholasX) sell options for
 * yield — the option book is the story, not the holdings churn.
 */
export type FundCategory = "active-equity" | "option-income";

export interface ApiOptionDetails {
    type: string;
    strike: number;
    expiry: string;
    underlying?: string;
    // Added 2026-09-27 on /api/v1/ticker option rows (optional: older API deploys).
    /** Uppercase CALL / PUT — `type` keeps the CSV's 'Call' / 'Put'. */
    optionType?: "CALL" | "PUT" | null;
    /** Signed contracts: negative = written. */
    contracts?: number;
    /** FLEX (non-listed) contract — often one leg of a synthetic. */
    isFlex?: boolean | null;
}

export interface ApiChangeRecord {
    fund: string;
    ticker: string;
    name: string;
    sector: string;
    weightDelta: number;
    /** Price-drift-removed weight delta — the part the manager actually chose.
     *  Use this for direction/conviction; falls back to weightDelta when absent. */
    activeWeightDelta?: number;
    sharesDelta: number;
    currentWeight: number;
    previousWeight: number;
    currentShares: number;
    previousShares: number;
    type: ChangeType;
    isOption: boolean;
    optionDetails?: ApiOptionDetails;
}

export interface ApiFundDetailRow {
    fund: string;
    weightDelta: number;
    currentWeight: number;
    type: ChangeType;
    /** Fund AUM in $B, from the backend's get_fund_aum(). Null when unknown. */
    aum?: number | null;
}

// ─── Endpoint response types ────────────────────────────────────────────────

export interface ApiStats {
    fundsTracked: number;
    uniqueTickers: number;
    optionsContracts: number;
    putCallRatio: number;
    /** Brand-new (fund, ticker) equity positions opened today across all tracked funds. */
    newPositionsToday?: number;
    /** Positions fully closed today — fund went from holding to zero shares. */
    exitsToday?: number;
}

export interface ApiSignal {
    ticker: string;
    name: string;
    sector: string;
    /** Legacy: aggregate weight delta. Same value as totalWeightDelta. */
    weightDelta: number;
    /** Legacy: list of fund names. Prefer fundDetails for richer info. */
    funds: string[];
    providers: string[];
    /** Legacy: AUM-weighted conviction (kept for back-compat). */
    conviction: number;
    direction: "buying" | "selling";
    // Enriched (review #10):
    fundDetails: ApiFundDetailRow[];
    fundCount: number;
    providerCount: number;
    totalWeightDelta: number;
    avgWeightDelta: number;
    convictionScore: number;
    streak: number | null;
}

export interface ApiSignals {
    buying: ApiSignal[];
    selling: ApiSignal[];
}

export interface ApiSectorEntry {
    sector: string;
    delta: number;
}

export interface ApiSectorFlow {
    inflows: ApiSectorEntry[];
    outflows: ApiSectorEntry[];
}

export interface ApiDivergenceFund {
    fund: string;
    provider: string;
    weightDelta: number;
}

export interface ApiDivergence {
    ticker: string;
    name: string;
    // Legacy:
    buying: string[];
    selling: string[];
    // Enriched:
    buyingFunds: ApiDivergenceFund[];
    sellingFunds: ApiDivergenceFund[];
    intrashop: boolean;
}

export interface ApiActivity {
    accumulating: ApiChangeRecord[];
    reducing: ApiChangeRecord[];
    optionsActivity: ApiChangeRecord[];
}

/** One fund's brand-new entry inside a layering cohort. */
export interface ApiLayeringEntry {
    fund: string;
    provider: string;
    /** Trading day the fund first held this ticker (ISO). */
    entryDate: string;
    /** Weight % at entry. */
    weight: number;
    /** Fund AUM ($B). */
    aum: number;
    /** Trading days after the FIRST entry in the cohort (0 = the first mover). */
    daysIntoLayering: number;
}

/** A ticker that 3+ stock-pickers piled into as a new position within days. */
export interface ApiLayeringPattern {
    ticker: string;
    name: string;
    sector: string;
    /** 0–100, relative to the strongest active pattern. */
    layeringStrength: number;
    distinctFunds: number;
    /** Distinct fund FAMILIES — cross-family agreement is the strong signal. */
    distinctProviders: number;
    providers: string[];
    /** Combined AUM ($B) of the funds that layered in. */
    consensusAum: number;
    firstEntry: string;
    lastEntry: string;
    /** Entry order, first mover → last (the part only daily data reveals). */
    entrySequence: ApiLayeringEntry[];
}

export interface ApiLayeringResponse {
    asOfDate: string;
    windowDays: number;
    minFunds: number;
    patterns: ApiLayeringPattern[];
    /** Total patterns found before the limit was applied. */
    total: number;
}

export interface ApiInstitutionalEntry {
    ticker: string;
    name: string;
    sector: string;
    /** AUM-weighted blended weight in the combined institutional book today (%). */
    blendedWeight: number;
    /** Blended weight at the start of the window (%). */
    previousBlendedWeight: number;
    /** Change in blended weight over the window (%). Positive = net buying. */
    weightDelta: number;
    /** How many institutional funds hold it today (0 = fully exited). */
    fundCount: number;
    funds: string[];
    direction: "buying" | "selling";
}

export interface ApiInstitutionalFlow {
    period: "daily" | "weekly" | "monthly";
    asOfDate: string;
    /** Number of institutional funds blended into the combined portfolio. */
    fundCount: number;
    /** Total AUM ($B) of the combined institutional book. */
    totalAum: number;
    buying: ApiInstitutionalEntry[];
    selling: ApiInstitutionalEntry[];
}

export interface ApiOptionSignal {
    strategy: string;
    directionalView: string;
    moneyness: string;
}

export interface ApiBriefing {
    topBuys: ApiSignal[];
    topSells: ApiSignal[];
    crossFundConvergence: ApiSignal[];
    activeStreaks: {
        fund: string;
        ticker: string;
        days: number;
        direction: "up" | "down";
    }[];
    notableOptions: {
        record: ApiChangeRecord;
        signal: ApiOptionSignal;
    }[];
}

export interface ApiFundSummary {
    fund: string;
    provider: string;
    category: FundCategory;
    aum: number | null;
    /** Enriched fields (present from /api/v1/funds; optional for back-compat). */
    holdingsCount?: number;
    optionsCount?: number;
    topHolding?: { ticker: string; weight: number } | null;
}

export type TrendSignal =
    | "accumulating"
    | "distribution-starting"
    | "distributing"
    | "bottoming";

export interface ApiTrendEntry {
    ticker: string;
    name: string;
    sector: string;
    /** Current AUM-blended weight in the combined institutional book (%). */
    blendedWeight: number;
    /** Blended-weight change over each horizon (%). Same fixed denominator. */
    daily: number;
    weekly: number;
    monthly: number;
    fundCount: number;
    signal: TrendSignal;
}

export interface ApiInstitutionalTrend {
    asOfDate: string;
    fundCount: number;
    tickers: ApiTrendEntry[];
}

export interface ApiTickerIndexEntry {
    ticker: string;
    name: string;
    sector: string;
    /** How many funds hold this ticker. */
    fundCount: number;
    funds: string[];
    /** Total weight summed across all holding funds (%). */
    totalWeight: number;
    /** Net daily weight change across funds (%). */
    netChange: number;
    /** Funds that opened a brand-new position in this ticker today. Empty when none. */
    newEntryFunds: string[];
    /** Funds that fully closed their position in this ticker today. Empty when none. */
    exitFunds?: string[];
    /**
     * Strongest multi-day accumulation/distribution streak across any fund holding
     * this ticker. Positive = buying streak (days), negative = selling streak.
     * Null/undefined = no streak of 2+ days.
     */
    streak?: number | null;
    /**
     * Number of distinct fund families (providers) holding this ticker.
     * Cross-family agreement is a stronger signal than multiple funds from one shop.
     */
    distinctProviders?: number;
}

export interface ApiFundDetail {
    fund: string;
    provider: string;
    category: FundCategory;
    aum: number | null;
    asOfDate?: string;
    holdingsCount: number;
    optionsCount: number;
    totalWeight: number;
    topHoldings: {
        ticker: string;
        name: string;
        weight: number;
        shares: number;
        sector: string;
        /** null on a catch-up fund (see catchUp/catchUpSince): the delta would span a stale gap. */
        weightDelta: number | null;
        activeWeightDelta?: number | null;
        sharesDelta: number | null;
    }[];
    /** The fund's own holdings date (issuer file). asOfDate is the snapshot date. */
    holdingsDate?: string | null;
    /** holdingsDate older than the previous trading day. */
    stale?: boolean;
    /** False = today's issuer fetch failed; rows carried forward. */
    refreshed?: boolean | null;
    /** True when the fund's latest daily delta is a catch-up across a carried-forward gap. */
    catchUp?: boolean;
    catchUpSince?: string | null;
    optionHoldings: ApiOptionHolding[];
    recentChanges: ApiChangeRecord[];
    streaks: ApiFundStreak[];
    flow: ApiFundFlow | null;
    optionRolls: ApiOptionRoll[];
}

/** A multi-day accumulation / distribution streak on one of a fund's holdings. */
export interface ApiFundStreak {
    ticker: string;
    days: number;
    direction: "up" | "down";
}

/** Net creation/redemption flow over a recent window. Null when the provider
 *  doesn't report shares outstanding (ARK and Avantis don't; most
 *  option-income and Corgi funds do). */
export interface ApiFundFlow {
    sharesOutstanding: number;
    sharesDelta: number;
    /** Net creation/redemption as a % of shares outstanding over the window.
     *  Price-free on purpose — share counts are clean, scraper prices aren't. */
    flowPct: number;
    periodDays: number;
}

/** One leg of an option roll. */
export interface ApiOptionRollLeg {
    strike: number;
    expiry: string;
}

/** An option roll — a contract closed and another opened on the same
 *  underlying and option type in the same window. */
export interface ApiOptionRoll {
    underlying: string;
    optionType: string;
    closed: ApiOptionRollLeg[];
    opened: ApiOptionRollLeg[];
}

/** A single live option position in a fund's book. */
export interface ApiOptionHolding {
    ticker: string;
    name: string;
    weight: number;
    shares: number;
    optionType: string;
    underlying: string;
    strike: number;
    expiry: string;
    /** Days to expiry. Null when the scraper didn't capture it. */
    dte: number | null;
    /** Signed moneyness ratio from the scraper. Null when not captured. */
    moneyness: number | null;
    /** Underlying spot price at snapshot time. Null when not captured. */
    underlyingPrice: number | null;
}

export interface ApiTickerHolding {
    fund: string;
    provider: string;
    weight: number;
    shares: number;
    isOption: boolean;
    optionDetails?: ApiOptionDetails;
    /** Fund AUM in $B, from the backend's get_fund_aum(). Null when unknown. */
    aum?: number | null;
    /** The fund's own holdings date (issuer file), not the snapshot date. */
    fileDate?: string | null;
    /** fileDate older than the previous trading day. */
    stale?: boolean;
    /** False = carried forward because today's issuer fetch failed. */
    refreshed?: boolean | null;
}

export interface ApiTickerDetail {
    ticker: string;
    name: string;
    sector: string;
    fundCount: number;
    holdings: ApiTickerHolding[];
    totalWeight: number;
    changes: ApiChangeRecord[];
}

export interface ApiStockHistoryPoint {
    date: string;
    /** AUM-blended institutional weight that day (%). */
    blendedWeight: number;
    /** Number of institutional funds holding it that day. */
    fundCount: number;
}

export interface ApiStockDetail extends ApiTickerDetail {
    institutional: {
        blendedWeight: number;
        daily: number;
        weekly: number;
        monthly: number;
        fundCount: number;
        signal: TrendSignal;
        /** Consecutive-day blended-weight streak. Positive = buying, negative = selling. Null when < 2 days. */
        streak: number | null;
        /** Approximate dollar exposure across all institutional equity holders ($M). Sum of weight% × fund AUM. */
        estimatedExposureM?: number;
    };
    /** Trading-day series (oldest → newest) for the trend chart. */
    history: ApiStockHistoryPoint[];
}

export interface ApiFullPayload {
    _meta: {
        endpoint: string;
        description: string;
        source: string;
    };
    asOfDate: string;
    stats: ApiStats;
    signals: ApiSignals;
    changes: ApiChangeRecord[];
    sectorFlow: ApiSectorFlow;
    divergences: ApiDivergence[];
    briefing: ApiBriefing;
    activity: ApiActivity;
}

export interface ApiTraderMatrixHandoff {
    name: string;
    tagline: string;
    url: string;
    why: string;
    is_referral: boolean;
}

export interface ApiPerformanceAggregate {
    /** Median forward return on the underlying. e.g. 0.0209 = +2.09%. */
    medianReturn: number;
    /** Fraction of signals where the direction matched the price move. */
    winRate: number;
    /** Number of signals in this bucket. */
    n: number;
}

export interface ApiSignalPerformance {
    asOf: string;
    generatedAt: string;
    lookbackDays: number;
    totalSignals: number;
    withReturns: number;
    overall: {
        buying: ApiPerformanceAggregate;
        selling: ApiPerformanceAggregate;
    };
    byProvider: Record<string, {
        buying: ApiPerformanceAggregate;
        selling: ApiPerformanceAggregate;
    }>;
}

// ─── CBOE Options Scanner ───────────────────────────────────────────────────

/** One side of a CBOE diff layer — ticker → company-name maps. */
export interface CboeDiffSection {
    new: Record<string, string>;
    removed: Record<string, string>;
}

export interface CboeScanResult {
    date: string;
    isInitial: boolean;
    totals: {
        allOptionable: number;
        weeklyEtfs: number;
        weeklyEquities: number;
    };
    diff: {
        optionable: CboeDiffSection;
        weeklyEtfs: CboeDiffSection;
        weeklyEquities: CboeDiffSection;
    };
    hasChanges: boolean;
}

export interface ApiOptionsListings {
    status: string;
    latest: CboeScanResult | null;
    history: CboeScanResult[];
}

// ─── Fetch wrapper ──────────────────────────────────────────────────────────

interface ApiOptions {
    /** Next.js revalidation in seconds. Defaults to 1 hour. */
    revalidate?: number;
    /** Throw on non-2xx (default true). Set false to return null on any failure. */
    throwOnError?: boolean;
    /** Retry attempts for transient failures (5xx / 429 / network). Default 3. */
    retries?: number;
}

/**
 * Error carrying the HTTP status code, so callers can distinguish a genuine
 * 404 ("this fund doesn't exist") from a transient 5xx / network failure
 * ("the API blipped"). Collapsing those two into a plain null is what baked
 * permanent 404s onto valid fund pages like /fund/AVUV.
 */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly path: string,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/** Worth retrying — a server-side or rate-limit hiccup. A 4xx never is:
 *  a 404 will not become a 200 on the next attempt. */
const isRetryable = (status: number) => status >= 500 || status === 429;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Core fetch: returns parsed JSON on 2xx, otherwise throws an ApiError.
 * Retries transient failures (5xx / 429 / network) with exponential backoff;
 * 4xx responses (including 404) throw immediately without retrying.
 */

// ─── Option-income analytics (/api/v1/income) ───────────────────────────────

/**
 * Structural archetype of an option-income fund. "Income ETF" is not one
 * thing — these five shapes need genuinely different views, and rendering
 * them identically misrepresents four of them.
 */
export type IncomeArchetype =
    | "covered-call"   // owns the stocks, writes calls against them
    | "synthetic"      // no shares — Treasuries + a replicating structure
    | "leap-proxy"     // long index calls; income leg written & expired intraday
    | "swap"           // total-return swap, no option rows
    | "short-equity"   // short stock positions
    | "unknown";

/** Every tile is nullable — an uncomputable metric must never render as 0. */
export interface ApiIncomeTiles {
    callCoveragePct: number | null;
    weightedMoneynessPct: number | null;
    weightedDte: number | null;
    upsideRoomPct: number | null;
    cappedNames: number;
    namesWithWrittenCalls: number;
    collateralPct: number;
    callNotionalPctNav: number | null;
    putNotionalPctNav: number | null;
    writtenCallLegs: number;
    writtenLegs: number;
}

export interface ApiIncomeSleeves {
    equity: number;
    treasury: number;
    cash: number;
    swap: number;
    optionsLong: number;
    optionsShort: number;
}

export interface ApiIncomeLeg {
    optionType: string;
    strike: number;
    expiry: string;
    dte: number | null;
    contracts: number;
    weight: number;
    written: boolean;
    moneyness: number | null;
    quotedSpot: number | null;
}

export interface ApiIncomeBookRow {
    underlying: string;
    equity: { ticker: string; name: string; weight: number; shares: number; price: number | null } | null;
    spot: number | null;
    /** True when the fund's own mark and the quote feed disagree past tolerance. */
    spotSuppressed: boolean;
    writtenCall: ApiIncomeLeg | null;
    writtenCallCount: number;
    writtenPutCount: number;
    longLegs: { optionType: string; strike: number; expiry: string; dte: number | null; contracts: number }[];
    coveredFraction: number | null;
    /** (K - S)/S — what a holder keeps before the cap bites. Not `moneyness`. */
    upsideRoomPct: number | null;
    capped: boolean;
    optionWeight: number;
    legCount: number;
}

export interface ApiIncomeFundSummary {
    fund: string;
    provider: string;
    aum: number | null;
    archetype: IncomeArchetype;
    archetypeLabel: string;
    archetypeSummary: string;
    netAssets: number | null;
    sleeves: ApiIncomeSleeves;
    counts: { equityPositions: number; optionLegs: number; underlyings: number };
    tiles: ApiIncomeTiles;
    /** False for leap-proxy funds — their 0DTE income leg never reaches an EOD file. */
    incomeLegVisible: boolean;
}

/** One leg of a dated option trade — contracts are signed (negative = written). */
export interface ApiActivityLeg {
    optionType: "CALL" | "PUT" | null;
    strike: number | null;
    expiry: string | null;
    contracts: number;
    prevContracts: number;
    change: number;
    isFlex: boolean | null;
    dte: number | null;
    marketValue: number | null;
}

export interface ApiOptionTrade {
    /** Paired by equal |contract change| within fund + underlying. */
    kind: "roll" | "synthetic" | "spread" | "collar" | "pair" | "single";
    /** For `single`: what the lone change was. */
    action?: "open" | "close" | "expired" | "add" | "reduce" | "flip";
    size: number;
    underlying: string;
    legs: ApiActivityLeg[];
}

export interface ApiOptionActivityDay {
    date: string;
    /** The fund's previous snapshot this day was diffed against. */
    compareDate: string;
    /** False = rows carried forward (issuer fetch failed) — no trades knowable. */
    refreshed: boolean | null;
    trades: ApiOptionTrade[];
}

/** An option leg inside a brokerage-style position row. */
export interface ApiPositionLeg {
    /** 'synthetic' = one half of a long-call/short-put synthetic stock pair. */
    role: "written-call" | "written-put" | "long-call" | "long-put" | "synthetic";
    optionType: string;
    strike: number;
    expiry: string;
    dte: number | null;
    /** Contract already expired but still in the provider's file. */
    expired: boolean;
    /** Signed contracts — negative = written. */
    contracts: number;
    /** Per-share option price (market value ÷ contracts ÷ 100). */
    price: number | null;
    marketValue: number | null;
    weight: number;
    /** (K − S)/S for written calls — how far the stock can run before the cap. */
    upsideRoomPct: number | null;
}

/** One stock, held outright and/or synthetically, with its option legs. */
export interface ApiPosition {
    ticker: string;
    name: string;
    /** Blank when neither the file nor the ticker fallback map knows it. */
    sector?: string;
    sharesHeld: number;
    syntheticShares: number;
    totalShares: number;
    price: number | null;
    spotSuppressed: boolean;
    marketValue: number;
    /** |totalShares| × price — includes synthetic shares, unlike marketValue. */
    exposureValue: number;
    weight: number;
    exposurePctNav: number | null;
    coveredShares: number;
    /** Null when the fund holds no shares (real or synthetic) in this name. */
    coveragePct: number | null;
    /** Written beyond shares held and beyond any long wings — genuinely naked. */
    nakedShares: number;
    legs: ApiPositionLeg[];
}

export interface ApiOtherPosition {
    sleeve: "treasury" | "cash" | "swap";
    label: string;
    marketValue: number;
    weight: number;
    lines: number;
}

export interface ApiPositionsSummary {
    coveredPct: number | null;
    uncoveredPct: number | null;
    syntheticPct: number | null;
    stockExposureValue: number;
    coveredValue: number;
    stockPositions: number;
    otherPctNav: number;
}

export interface ApiIncomeFund extends ApiIncomeFundSummary {
    book: ApiIncomeBookRow[];
    asOfDate: string;
    /** Optional — absent from API deploys that predate the positions view. */
    positions?: ApiPosition[];
    /** Dated option trades, newest day first (last 10 snapshots). */
    optionActivity?: ApiOptionActivityDay[];
    otherPositions?: ApiOtherPosition[];
    positionsSummary?: ApiPositionsSummary;
}

export interface ApiIncomeOverview {
    asOfDate: string;
    fundCount: number;
    funds: ApiIncomeFundSummary[];
    archetypes: { key: IncomeArchetype; label: string; summary: string; funds: string[] }[];
}

async function rawFetch<T>(path: string, revalidate: number, retries: number): Promise<T> {
    const url = `${API_BASE}${path}`;
    // Vercel's Data Cache silently refuses to store any entry over 2MB — it
    // logs a warning and keeps serving whatever it cached last (if anything),
    // which for a growing payload means "stuck on old data forever" the
    // moment it crosses 2MB, with no error surfaced anywhere but the log.
    // revalidate <= 0 opts out of the Data Cache entirely (cache: 'no-store')
    // for endpoints whose payload is documented to exceed that limit.
    const fetchInit: RequestInit = revalidate > 0
        ? { next: { revalidate } }
        : { cache: 'no-store' };
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, fetchInit);
            if (res.ok) return (await res.json()) as T;
            const body = await res.text().catch(() => res.statusText);
            const err = new ApiError(res.status, path, `API ${res.status} on ${path}: ${body}`);
            if (!isRetryable(res.status)) throw err; // 4xx — give up immediately
            lastError = err;
        } catch (e) {
            // A non-retryable ApiError (4xx) must propagate straight away.
            if (e instanceof ApiError && !isRetryable(e.status)) throw e;
            // Network-level failure (DNS / TLS / connection reset) or a 5xx.
            lastError = e;
        }
        if (attempt < retries) await sleep(250 * 2 ** attempt); // 250ms, 500ms, 1s …
    }
    throw lastError;
}

/**
 * Graceful fetch — returns null on ANY failure when throwOnError is false.
 * Use for endpoints where an empty-state shell is an acceptable fallback
 * (dashboard headline payload, optional cards).
 */
async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T | null> {
    const { revalidate = 3600, throwOnError = true, retries = 3 } = opts;
    try {
        return await rawFetch<T>(path, revalidate, retries);
    } catch (e) {
        if (throwOnError) throw e;
        return null;
    }
}

/**
 * Resource fetch — returns null ONLY on a genuine 404, and re-throws on a
 * transient failure (5xx / network) once retries are exhausted.
 *
 * This is what makes fund pages self-healing: a `null` means "this fund
 * really doesn't exist" → notFound(); a thrown error means "the API
 * blipped" → Next.js renders the error boundary and retries on the next
 * request, instead of permanently caching a wrong 404.
 */
async function apiFetchResource<T>(path: string, opts: ApiOptions = {}): Promise<T | null> {
    const { revalidate = 3600, retries = 3 } = opts;
    try {
        return await rawFetch<T>(path, revalidate, retries);
    } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
    }
}

// ─── Endpoint wrappers ──────────────────────────────────────────────────────

export const api = {
    /** Full headline payload — signals, changes, sector flow, divergences, briefing, activity.
     *  Payload routinely exceeds 2.3MB, over Vercel's 2MB Data Cache entry
     *  limit — revalidate: 0 opts out of that cache (see rawFetch) so it
     *  never gets stuck serving a stale response. */
    signals: (opts?: ApiOptions) =>
        apiFetch<ApiFullPayload>("/api/v1/signals", { revalidate: 0, ...opts }),

    stats: (opts?: ApiOptions) =>
        apiFetch<ApiStats>("/api/v1/stats", opts),

    sectors: (opts?: ApiOptions) =>
        apiFetch<ApiSectorFlow>("/api/v1/sectors", opts),

    divergences: (opts?: ApiOptions) =>
        apiFetch<ApiDivergence[]>("/api/v1/divergences", opts),

    /** Cross-fund layering — 3+ stock-pickers opening the same new position in days. */
    layering: (
        params: { windowDays?: number; minFunds?: number; limit?: number } = {},
        opts?: ApiOptions,
    ) => {
        const qs = new URLSearchParams();
        if (params.windowDays) qs.set("window_days", String(params.windowDays));
        if (params.minFunds) qs.set("min_funds", String(params.minFunds));
        if (params.limit) qs.set("limit", String(params.limit));
        const query = qs.toString();
        return apiFetch<ApiLayeringResponse>(
            `/api/v1/layering-patterns${query ? `?${query}` : ""}`,
            { revalidate: 600, throwOnError: false, ...opts },
        );
    },

    briefing: (opts?: ApiOptions) =>
        apiFetch<ApiBriefing>("/api/v1/briefing", opts),

    /** Weekly/monthly activity payloads also routinely exceed 2MB — same
     *  Data Cache opt-out as signals() above. */
    activity: (period: "daily" | "weekly" | "monthly" = "daily", opts?: ApiOptions) =>
        apiFetch<ApiActivity>(`/api/v1/activity?period=${period}`, { revalidate: 0, ...opts }),

    /** Institutions-as-a-whole AUM-weighted blended flow (income funds excluded). */
    institutional: (
        period: "daily" | "weekly" | "monthly" = "daily",
        limit = 25,
        opts?: ApiOptions,
    ) =>
        apiFetch<ApiInstitutionalFlow>(
            `/api/v1/institutional?period=${period}&limit=${limit}`,
            { revalidate: 600, ...opts },
        ),

    funds: (opts?: ApiOptions) =>
        apiFetch<{ funds: ApiFundSummary[]; asOfDate?: string }>("/api/v1/funds", opts),

    /** Per-ticker institutional flow across day/week/month — the trend-overlay visual. */
    institutionalTrend: (limit = 15, opts?: ApiOptions) =>
        apiFetch<ApiInstitutionalTrend>(
            `/api/v1/institutional-trend?limit=${limit}`,
            { revalidate: 600, ...opts },
        ),

    /** Most widely-held underlying tickers across all funds — the /stocks index. */
    tickers: (
        sort: "funds" | "weight" = "funds",
        limit = 100,
        opts?: ApiOptions,
    ) =>
        apiFetch<{ count: number; asOfDate?: string; tickers: ApiTickerIndexEntry[] }>(
            `/api/v1/tickers?sort=${sort}&limit=${limit}`,
            { revalidate: 600, ...opts },
        ),

    /**
     * Fund detail. Resolves to null ONLY when the fund genuinely doesn't
     * exist (404); a transient API failure throws (after retries) so the
     * caller can render an error boundary instead of a permanent 404.
     *
     * 10-minute fetch cache: fund pages should track the data closely, and a
     * short window also means a frontend/API deploy can't leave a page stale
     * for a full hour.
     */
    fund: (ticker: string, opts?: ApiOptions) =>
        apiFetchResource<ApiFundDetail>(`/api/v1/fund/${encodeURIComponent(ticker)}`, {
            revalidate: 600,
            ...opts,
        }),

    ticker: (ticker: string, opts?: ApiOptions) =>
        apiFetch<ApiTickerDetail>(`/api/v1/ticker/${encodeURIComponent(ticker)}`, {
            throwOnError: false,
            ...opts,
        }),

    /** Per-stock page — holders + institutional A/D trend & history series. */
    stock: (ticker: string, opts?: ApiOptions) =>
        apiFetchResource<ApiStockDetail>(`/api/v1/stock/${encodeURIComponent(ticker)}`, {
            revalidate: 600,
            ...opts,
        }),

    changes: (
        params: {
            provider?: string;
            fund?: string;
            direction?: "buying" | "selling";
            period?: "daily" | "weekly" | "monthly";
            limit?: number;
        } = {},
        opts?: ApiOptions,
    ) => {
        const qs = new URLSearchParams();
        if (params.provider) qs.set("provider", params.provider);
        if (params.fund) qs.set("fund", params.fund);
        if (params.direction) qs.set("direction", params.direction);
        if (params.period) qs.set("period", params.period);
        if (params.limit) qs.set("limit", String(params.limit));
        const query = qs.toString();
        return apiFetch<{ asOfDate: string; count: number; changes: ApiChangeRecord[] }>(
            `/api/v1/changes${query ? `?${query}` : ""}`,
            { revalidate: 600, ...opts },
        );
    },

    tradermatrix: (opts?: ApiOptions) =>
        apiFetch<ApiTraderMatrixHandoff>("/api/v1/tradermatrix", opts),

    /** @deprecated Use `tradermatrix` instead. TraderDaddy rebranded to
     * TraderMatrix in September 2026; this hits the deprecated
     * /api/v1/traderdaddy alias, which returns the identical payload. */
    traderdaddy: (opts?: ApiOptions) =>
        apiFetch<ApiTraderMatrixHandoff>("/api/v1/traderdaddy", opts),

    signalPerformance: (opts?: ApiOptions) =>
        apiFetch<ApiSignalPerformance>("/api/v1/signal-performance", {
            throwOnError: false,
            ...opts,
        }),

    /** CBOE Options Scanner — newly optionable stocks + weekly-options changes. */
    optionsListings: (opts?: ApiOptions) =>
        apiFetch<ApiOptionsListings>("/api/v1/options-listings", {
            throwOnError: false,
            ...opts,
        }),

    /** Every option-income fund, classified by structure, with coverage tiles. */
    income: (opts?: ApiOptions) =>
        apiFetch<ApiIncomeOverview>("/api/v1/income", {
            revalidate: 600,
            throwOnError: false,
            ...opts,
        }),

    /** One income fund's book — one row per underlying, not per contract. */
    incomeFund: (fund: string, opts?: ApiOptions) =>
        apiFetchResource<ApiIncomeFund>(`/api/v1/income/${fund.toUpperCase()}`, {
            revalidate: 600,
            throwOnError: false,
            ...opts,
        }),

    holdings: (opts?: ApiOptions) =>
        apiFetch<{
            asOfDate: string;
            count: number;
            holdings: {
                fund: string;
                ticker: string;
                name: string;
                sector: string;
                weight: number;
                shares: number;
                /** null on a catch-up fund (row has catchUpSince). */
                weightDelta: number | null;
                sharesDelta: number | null;
                catchUpSince?: string;
                isOption: boolean;
                cusip: string;
                // Added 2026-09-27 — optional so older API deploys still type-check.
                marketValue?: number | null;
                fileDate?: string | null;
                refreshed?: boolean | null;
                stale?: boolean;
                underlying?: string | null;
                optionType?: "CALL" | "PUT" | null;
                strike?: number | null;
                expiry?: string | null;
                contracts?: number | null;
                isFlex?: boolean | null;
            }[];
        }>("/api/v1/holdings", opts),
};
