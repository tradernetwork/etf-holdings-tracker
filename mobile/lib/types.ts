/**
 * Response shapes for the endpoints the app uses.
 *
 * The API's OpenAPI document types these routes' bodies as plain objects (the
 * FastAPI handlers return dicts), so generated types only give us the *paths*
 * and query params (see generated/api-types.ts). Bodies are described here, by
 * hand, narrowly: only fields the UI reads. Dollar fields (`aumUsd`,
 * `positionUsd`, `activeFlowUsd`) are optional: they ship with API PR #142.
 */
export type Category = "active-equity" | "option-income";
/** What the user picks in the segmented control; "all" sends no category. */
export type CategoryChoice = Category | "all";
export type ChangeType = "NEW" | "CHANGED" | "REMOVED" | string;

export interface FundDetailRow {
  fund: string;
  activeWeightDelta: number;
  currentWeight?: number;
  type?: ChangeType;
  aum?: number | null; // billions
  aumUsd?: number | null;
  activeFlowUsd?: number | null;
}

export interface Signal {
  ticker: string;
  name: string;
  sector: string;
  direction: "buying" | "selling";
  /** Sum of active-weight deltas across funds, percentage points. */
  weightDelta: number;
  convictionScore: number;
  /** Consecutive sessions in this direction, when the API has one. */
  streak?: number | null;
  funds: string[];
  fundCount: number;
  providerCount: number;
  fundDetails: FundDetailRow[];
}

export interface Change {
  fund: string;
  ticker: string;
  name: string;
  sector: string;
  /** Active-weight change, percentage points. Drives direction and size. null on a catch-up fund (API #144): never significant. */
  activeWeightDelta: number | null;
  /** Raw weight change (includes price drift). Transparency only. null on a catch-up fund. */
  weightDelta: number | null;
  /** Reported share-count change. */
  sharesDelta?: number | null; // null on a catch-up fund
  currentWeight: number;
  previousWeight: number;
  type: ChangeType;
  isOption: boolean;
  fundCategory?: Category;
  positionUsd?: number | null;
  activeFlowUsd?: number | null;
}

/** A change whose active delta is known (non-null). Catch-up funds' rows are not. */
export type Moved = Change & { activeWeightDelta: number };
export const hasDelta = (c: Change): c is Moved => c.activeWeightDelta != null;

export interface Stats {
  asOfDate: string;
  fundsTracked: number;
  uniqueTickers: number;
  newPositionsToday: number;
  exitsToday: number;
}

export interface SignalsResponse {
  asOfDate: string;
  category: string | null;
  stats: Stats;
  signals: { buying: Signal[]; selling: Signal[] };
  changes: Change[];
}

export interface DivergenceSide {
  fund: string;
  provider: string;
  category: Category;
  /** Active-weight change, percentage points. */
  weightDelta: number;
}

export interface Divergence {
  ticker: string;
  name: string;
  buyingFunds: DivergenceSide[];
  sellingFunds: DivergenceSide[];
}

export interface SectorFlowRow {
  sector: string;
  delta: number;
}
export interface SectorsResponse {
  inflows: SectorFlowRow[];
  outflows: SectorFlowRow[];
}

export interface LayeringEntry {
  fund: string;
  provider: string;
  entryDate: string;
  weight: number;
  aum: number | null; // billions
  aumUsd?: number | null;
  positionUsd?: number | null;
}
export interface LayeringPattern {
  ticker: string;
  name: string;
  distinctFunds: number;
  distinctProviders: number;
  firstEntry: string;
  lastEntry: string;
  entrySequence: LayeringEntry[];
  consensusAum?: number | null; // billions
  consensusAumUsd?: number | null;
  positionUsdTotal?: number | null;
}
export interface LayeringResponse {
  asOfDate: string;
  windowDays: number;
  patterns: LayeringPattern[];
}

export interface FundSummary {
  fund: string;
  provider: string;
  category: Category;
  aum: number | null; // billions
  aumUsd?: number | null;
  holdingsCount: number;
  optionsCount: number;
  lastHoldingsDate: string;
  stale: boolean;
}
export interface FundsResponse {
  asOfDate: string;
  category: string | null;
  funds: FundSummary[];
}

export interface TickerHolding {
  fund: string;
  provider: string;
  weight: number;
  isOption: boolean;
  aum: number | null; // billions
  aumUsd?: number | null;
  positionUsd?: number | null;
  fileDate: string;
  stale: boolean;
}
export interface TickerResponse {
  ticker: string;
  name: string;
  sector: string;
  fundCount: number;
  holdings: TickerHolding[];
  changes: Change[];
}

export interface FundTopHolding {
  ticker: string;
  name: string;
  weight: number;
  sector: string;
  weightDelta?: number | null;
  sharesDelta?: number | null;
  /** null on a catch-up fund. */
  activeWeightDelta?: number | null;
  positionUsd?: number | null;
}
export interface FundResponse {
  fund: string;
  provider: string;
  category: Category;
  aum: number | null; // billions
  aumUsd?: number | null;
  asOfDate: string;
  holdingsDate: string;
  stale: boolean;
  /** True when the latest diff spans a gap (API #144): its deltas are null, not a one-day change. */
  catchUp?: boolean;
  /** Last real disclosure date the diff spans from. */
  catchUpSince?: string | null;
  holdingsCount: number;
  optionsCount: number;
  totalWeight: number;
  topHoldings: FundTopHolding[];
  recentChanges: Change[];
}
