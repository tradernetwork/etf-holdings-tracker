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
}

export interface ApiChangeRecord {
    fund: string;
    ticker: string;
    name: string;
    sector: string;
    weightDelta: number;
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
}

// ─── Endpoint response types ────────────────────────────────────────────────

export interface ApiStats {
    fundsTracked: number;
    uniqueTickers: number;
    optionsContracts: number;
    putCallRatio: number;
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
}

export interface ApiFundDetail {
    fund: string;
    provider: string;
    category: FundCategory;
    aum: number | null;
    holdingsCount: number;
    optionsCount: number;
    totalWeight: number;
    topHoldings: {
        ticker: string;
        name: string;
        weight: number;
        shares: number;
        sector: string;
        weightDelta: number;
        sharesDelta: number;
    }[];
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
    /**
     * Total time budget in ms across every attempt, backoff included. Default
     * 8000. Whop keeps the iframe hidden until the document finishes loading,
     * so an unbounded fetch against a slow API is a blank app — a deadline
     * turns that into an empty-state card instead.
     */
    deadlineMs?: number;
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
async function rawFetch<T>(
    path: string,
    revalidate: number,
    retries: number,
    deadlineMs: number,
): Promise<T> {
    const url = `${API_BASE}${path}`;
    const deadline = Date.now() + deadlineMs;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        try {
            const res = await fetch(url, {
                next: { revalidate },
                signal: AbortSignal.timeout(remaining),
            });
            if (res.ok) return (await res.json()) as T;
            const body = await res.text().catch(() => res.statusText);
            const err = new ApiError(res.status, path, `API ${res.status} on ${path}: ${body}`);
            if (!isRetryable(res.status)) throw err; // 4xx — give up immediately
            lastError = err;
        } catch (e) {
            // A non-retryable ApiError (4xx) must propagate straight away.
            if (e instanceof ApiError && !isRetryable(e.status)) throw e;
            // Network-level failure (DNS / TLS / connection reset), a 5xx, or
            // the deadline firing mid-request.
            lastError = e;
        }
        const backoff = 250 * 2 ** attempt; // 250ms, 500ms, 1s …
        if (attempt < retries && Date.now() + backoff < deadline) await sleep(backoff);
        else break;
    }
    throw lastError ?? new Error(`API deadline (${deadlineMs}ms) exceeded on ${path}`);
}

/**
 * Graceful fetch — returns null on ANY failure when throwOnError is false.
 * Use for endpoints where an empty-state shell is an acceptable fallback
 * (dashboard headline payload, optional cards).
 */
async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T | null> {
    const { revalidate = 3600, throwOnError = true, retries = 3, deadlineMs = 8000 } = opts;
    try {
        return await rawFetch<T>(path, revalidate, retries, deadlineMs);
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
    const { revalidate = 3600, retries = 3, deadlineMs = 8000 } = opts;
    try {
        return await rawFetch<T>(path, revalidate, retries, deadlineMs);
    } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
    }
}

// ─── Endpoint wrappers ──────────────────────────────────────────────────────

export const api = {
    /** Full headline payload — signals, changes, sector flow, divergences, briefing, activity. */
    signals: (opts?: ApiOptions) =>
        apiFetch<ApiFullPayload>("/api/v1/signals", opts),

    stats: (opts?: ApiOptions) =>
        apiFetch<ApiStats>("/api/v1/stats", opts),

    sectors: (opts?: ApiOptions) =>
        apiFetch<ApiSectorFlow>("/api/v1/sectors", opts),

    divergences: (opts?: ApiOptions) =>
        apiFetch<ApiDivergence[]>("/api/v1/divergences", opts),

    briefing: (opts?: ApiOptions) =>
        apiFetch<ApiBriefing>("/api/v1/briefing", opts),

    activity: (period: "daily" | "weekly" | "monthly" = "daily", opts?: ApiOptions) =>
        apiFetch<ApiActivity>(`/api/v1/activity?period=${period}`, opts),

    funds: (opts?: ApiOptions) =>
        apiFetch<{ funds: ApiFundSummary[] }>("/api/v1/funds", opts),

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
                weightDelta: number;
                sharesDelta: number;
                isOption: boolean;
                cusip: string;
            }[];
        }>("/api/v1/holdings", opts),
};
