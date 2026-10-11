/** Wire shapes for the complete Today payload (/api/v1/signals) and layering. Straight from the API. */
import type { OptionActivityRecord } from "@/lib/options/types";

export type Direction = "buying" | "selling";
export type ChangeKind = "NEW" | "REMOVED" | "CHANGED";

export interface TodayStats {
  asOfDate: string;
  fundsTracked: number;
  uniqueTickers: number;
  optionsContracts: number;
  putCallRatio: number;
  newPositionsToday: number;
  exitsToday: number;
}

export interface SignalFund {
  fund: string;
  /** Active-weight change (pp), what drives direction. */
  weightDelta: number;
  rawWeightDelta: number;
  activeWeightDelta: number;
  sharesDelta: number;
  currentWeight: number;
  type: ChangeKind;
  aum?: number | null; // $B
  aumUsd?: number | null;
}

export interface FullSignal {
  ticker: string;
  name: string;
  sector: string;
  direction: Direction;
  funds: string[];
  providers: string[];
  fundCount: number;
  providerCount: number;
  fundDetails: SignalFund[];
  /** Sum of active deltas, pp. */
  totalWeightDelta: number;
  rawWeightDelta: number;
  avgWeightDelta: number;
  weightDelta: number;
  /** (# funds) x (weight moved) x (avg fund AUM): the website's "conv" number. */
  convictionScore: number;
  conviction: number;
  streak: number | null;
}

export interface ActiveStreak { fund: string; ticker: string; days: number; direction: "up" | "down" }
export interface NotableOption { record: OptionActivityRecord; signal: { strategy: string; directionalView: string; moneyness: string } }

export interface Briefing {
  topBuys: FullSignal[];
  topSells: FullSignal[];
  crossFundConvergence: FullSignal[];
  activeStreaks: ActiveStreak[];
  notableOptions: NotableOption[];
}

export interface DivergenceSide { fund: string; provider: string; category: string; weightDelta: number; rawWeightDelta: number }
export interface FullDivergence {
  ticker: string;
  name: string;
  buying: string[];
  selling: string[];
  buyingFunds: DivergenceSide[];
  sellingFunds: DivergenceSide[];
  /** Both sides are the same provider (one shop's funds disagreeing with each other). */
  intrashop: boolean;
  /** A stock-picker disagrees with an option-overlay fund: mechanics, not conviction. */
  crossCategory: boolean;
}

export interface SectorFlowEntry { sector: string; delta: number }

export interface TodayFull {
  asOfDate: string;
  category: string | null;
  stats: TodayStats;
  signals: { buying: FullSignal[]; selling: FullSignal[] };
  sectorFlow: { inflows: SectorFlowEntry[]; outflows: SectorFlowEntry[] };
  divergences: FullDivergence[];
  briefing: Briefing;
  /** Funds returning from a stale stretch: fund -> since date. Their daily deltas are withheld. */
  catchUp?: Record<string, string | null>;
}

// ---- layering ----------------------------------------------------------------------

export interface LayeringEntryFull {
  fund: string;
  provider: string;
  entryDate: string;
  weight: number;
  positionUsd?: number | null;
  aum: number | null; // $B
  aumUsd?: number | null;
  daysIntoLayering: number;
}
export interface LayeringPatternFull {
  ticker: string;
  name: string;
  sector: string;
  distinctFunds: number;
  distinctProviders: number;
  providers: string[];
  /** Combined AUM ($B) of the participating funds: NOT the capital invested in this ticker. */
  consensusAum: number;
  consensusAumUsd?: number | null;
  /** Estimated total entry-position value (USD). null when any fund's AUM is unknown. */
  positionUsdTotal?: number | null;
  firstEntry: string;
  lastEntry: string;
  entrySequence: LayeringEntryFull[];
  /** 0 to 100, scaled against the strongest active pattern. */
  layeringStrength: number;
}
export interface LayeringFull {
  asOfDate: string;
  windowDays: number;
  minFunds: number;
  total: number;
  patterns: LayeringPatternFull[];
}
