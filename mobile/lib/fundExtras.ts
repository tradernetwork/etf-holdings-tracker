/**
 * Everything the fund screen needs beyond /fund/{fund} and the full book: the income portfolio,
 * dated option activity, strategy effectiveness, period changes and the ULTI/ULTY rotation report.
 * Types and fetchers live here (not in api.ts / types.ts) so other screens can grow independently.
 */
import { ApiError, NetworkError } from "./api";
import { fetchWithRetry } from "./retry";
import type { Change } from "./types";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

// ---- /api/v1/income/{fund} -------------------------------------------------------

export type LegRole = "written-call" | "written-put" | "long-call" | "long-put" | "synthetic";

export interface PositionLeg {
  role: LegRole;
  optionType: string;
  strike: number;
  expiry: string;
  dte: number | null;
  /** Contract already expired but still in the provider's file. */
  expired: boolean;
  /** Signed contracts: negative = written. */
  contracts: number;
  /** Per-share option price. */
  price: number | null;
  marketValue: number | null;
  weight: number;
  /** (K − S)/S for written calls: how far the stock can run before the cap. */
  upsideRoomPct: number | null;
}

/** One stock, held outright and/or synthetically, with its option legs. */
export interface IncomePosition {
  ticker: string;
  name: string;
  sector?: string;
  sharesHeld: number;
  syntheticShares: number;
  totalShares: number;
  price: number | null;
  spotSuppressed: boolean;
  marketValue: number;
  /** |totalShares| × price: includes synthetic shares, unlike marketValue. */
  exposureValue: number;
  weight: number;
  exposurePctNav: number | null;
  coveredShares: number;
  coveragePct: number | null;
  nakedShares: number;
  legs: PositionLeg[];
}

export interface OtherPosition {
  sleeve: "treasury" | "cash" | "swap";
  label: string;
  marketValue: number;
  weight: number;
  lines: number;
}

export interface PositionsSummary {
  coveredPct: number | null;
  uncoveredPct: number | null;
  syntheticPct: number | null;
  stockExposureValue: number;
  coveredValue: number;
  stockPositions: number;
  otherPctNav: number;
}

export interface ActivityLeg {
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
export interface OptionTrade {
  kind: "roll" | "synthetic" | "spread" | "collar" | "pair" | "single";
  action?: "open" | "close" | "expired" | "add" | "reduce" | "flip";
  size: number;
  underlying: string;
  legs: ActivityLeg[];
}
export interface OptionActivityDay {
  date: string;
  compareDate: string;
  /** False = rows carried forward (issuer fetch failed): no trades knowable. */
  refreshed: boolean | null;
  trades: OptionTrade[];
}

export interface IncomeFundResponse {
  fund: string;
  provider: string;
  archetype?: string;
  archetypeLabel?: string;
  archetypeSummary?: string;
  /** False when the fund writes intraday options that never appear in an end-of-day file (e.g. QDTE). */
  incomeLegVisible?: boolean;
  asOfDate: string;
  sleeves?: { equity: number; treasury: number; cash: number; swap: number; optionsLong: number; optionsShort: number };
  positions?: IncomePosition[];
  otherPositions?: OtherPosition[];
  positionsSummary?: PositionsSummary;
  optionActivity?: OptionActivityDay[];
}

// ---- /api/v1/fund-effectiveness ----------------------------------------------------

export interface Effectiveness {
  fund: string;
  asOfDate: string;
  dataStale?: boolean;
  staleSnapshots?: number;
  historyDepth: number;
  optionsCount: number;
  netAssets: number | null;
  grade: string;
  compositeScore: number | null;
  weights: Record<string, number>;
  strategyDescription: string;
  peerGroup: string;
  writeCadenceDays?: number | null;
  syntheticPairs?: number;
  hedgingMandated: boolean;
  strikeSelection: {
    avgMoneyness: number | null; callAvgMoneyness: number | null; putAvgMoneyness: number | null;
    distribution: { deepOTM: number; slightlyOTM: number; atm: number; itm: number };
    writtenCount: number; callCount: number; putCount: number; dataCoverage?: number | null; score: number | null;
  };
  dteManagement: {
    avgDTE: number | null; distribution: { weekly: number; biweekly: number; monthly: number; longDated: number };
    consistency: number | null; gammaRiskFlag: boolean; score: number | null;
  };
  spreadEfficiency: {
    spreadCount: number; nakedCount: number; coveredCount: number; syntheticCount?: number; spreadRatio: number | null;
    avgRiskReward: number | null; avgWidthPct: number | null;
    spreads: { underlying: string; type: string; shortStrike: number; longStrike: number; width: number; widthPct: number; riskReward: number }[];
    score: number | null;
  };
  rollBehavior: {
    rollsDetected: number; avgRollDTE: number | null; strikeAdjustments: { rolledUp: number; rolledDown: number; same: number };
    weekendGapRolls: number;
    recentRolls: { underlying: string; type: string; fromExpiry: string; toExpiry: string; oldStrike: number; newStrike: number; rollDTE: number | null; weekendGap: boolean }[];
    score: number | null;
  };
  premiumCapture: {
    totalPremiumWritten: number; totalPremiumBought: number; netPremium: number; premiumAsPercentNAV: number | null;
    hedgeCostRatio: number | null; premiumDensity: number | null; positionsWritten: number; positionsBought: number; score: number | null;
  };
  hedgeRatio: {
    netPortfolioDelta: number | null; coverageRatio: number | null; collarCount: number; coveredCallCount: number;
    avgAbsDelta: number | null; score: number | null;
  };
  concentrationRisk: {
    hhi: number | null; uniqueUnderlyings: number; topExpiryConcentration: number | null; expiryCount: number; score: number | null;
  };
}

// ---- rotation report (website static JSON) ------------------------------------------

export interface RotationData {
  fund: string;
  groupBy: string; // "theme" | "sector"
  blurb: string;
  asOf: string;
  holdings: number;
  dates: string[];
  themes: string[];
  timeline: { date: string; weights: Record<string, number> }[];
  currentThemes: Record<string, number>;
  churnSincePrior: { added: string[]; dropped: string[]; held: string[]; rate: number };
  unmapped?: string[];
  /** The report's asOf is older than the previous trading day (API #156). */
  stale?: boolean;
  /** The holdings snapshot the report was served against (API #156). */
  snapshotAsOfDate?: string;
}
/** Funds that have a rotation report; avoids pointless 404s for the rest. */
export const ROTATION_FUNDS = new Set(["ULTI", "ULTY"]);

// ---- fetchers ------------------------------------------------------------------------

export type ChangePeriod = "daily" | "weekly" | "monthly";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithRetry(fetch, url, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new NetworkError(e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as T;
}

export const fundExtras = {
  income: (fund: string, signal?: AbortSignal) => getJson<IncomeFundResponse>(`${API_BASE}/api/v1/income/${encodeURIComponent(fund)}`, signal),
  /** The whole window (limit 1000 captures every move, even AVUV's monthly ~800). */
  changes: (fund: string, period: ChangePeriod, signal?: AbortSignal) =>
    getJson<{ asOfDate: string; previousDate?: string | null; comparisonTradingDays?: number | null; count: number; changes: Change[] }>(
      `${API_BASE}/api/v1/changes?fund=${encodeURIComponent(fund)}&period=${period}&limit=1000`, signal),
  effectiveness: (fund: string, signal?: AbortSignal) => getJson<Effectiveness>(`${API_BASE}/api/v1/fund-effectiveness/${encodeURIComponent(fund)}`, signal),
  peers: (signal?: AbortSignal) => getJson<{ funds: Effectiveness[] }>(`${API_BASE}/api/v1/fund-effectiveness`, signal),
  /** Same-origin with the API (so the web preview needs no CORS): ULTI and ULTY only, a 404 lists the funds that have one. */
  rotation: (fund: string, signal?: AbortSignal) => getJson<RotationData>(`${API_BASE}/api/v1/fund/${encodeURIComponent(fund)}/rotation`, signal),
};
