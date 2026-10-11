/** Wire shapes for the option screens. Straight from the API; nothing is renamed. */

export type ChangeType = "NEW" | "REMOVED" | "CHANGED";
export type ActivityPeriod = "daily" | "weekly" | "monthly";

/** /api/v1/activity -> optionsActivity[]. One option contract's change at one fund. */
export interface OptionActivityRecord {
  fund: string;
  /** The contract symbol, e.g. "MSTR  261120C00135000" (or an issuer placeholder). */
  ticker: string;
  name: string;
  sector: string;
  type: ChangeType;
  isOption: boolean;
  /** Raw % change in the contract's weight (an option's weight moves with its premium). */
  weightDelta: number;
  activeWeightDelta: number;
  /** Change in signed contracts. */
  sharesDelta: number;
  currentWeight: number;
  previousWeight: number;
  /** Signed contracts now / before: negative = written (short). */
  currentShares: number;
  previousShares: number;
  fundCategory?: "active-equity" | "option-income";
  optionDetails?: { type: string; strike: number; expiry: string; underlying: string };
}

export interface ActivityResponse {
  accumulating: unknown[];
  reducing: unknown[];
  optionsActivity: OptionActivityRecord[];
}

/** /api/v1/options-listings (CBOE scanner). Entries are { SYMBOL: "Company name" }. */
export type ListingEntries = Record<string, string>;
export interface ListingCategoryDiff { new: ListingEntries; removed: ListingEntries }
export interface ListingScan {
  /** ISO timestamp of the scan. */
  date: string;
  /** First ever scan: everything looks "new", so the site calls it a baseline. */
  isInitial: boolean;
  totals: { allOptionable: number; weeklyEtfs: number; weeklyEquities: number };
  diff: { optionable: ListingCategoryDiff; weeklyEtfs: ListingCategoryDiff; weeklyEquities: ListingCategoryDiff };
  hasChanges: boolean;
}
export interface ListingsResponse {
  status: string;
  latest: ListingScan | null;
  history: ListingScan[];
}

/** /api/v1/options-listings/schedule — the MWF Elite 0DTE calendar (ET). */
export interface MwfSchedule {
  tickers: string[];
  excludes: string[];
  expirationWeekdays: string[];
  timezone: string;
  today: string;
  dayName: string;
  isExpirationDay: boolean;
  nextExpirationDay: string;
  nextExpirationDate: string | null;
  holidays: string[];
}

/** /api/v1/options/{underlying}: every tracked fund's legs on one stock, grouped. */
export interface OptionLeg {
  optionType: "CALL" | "PUT" | string;
  strike: number | null;
  expiry: string | null;
  /** Signed: negative = written (short). */
  contracts: number;
  isFlex: boolean | null;
  dte: number | null;
  marketValue: number | null;
  occ?: string;
  prevContracts: number | null;
  /** Contracts added (+) or removed (−) since the compare date; null when unknown. */
  change: number | null;
}
export type StructureKind = "single" | "call-spread" | "put-spread" | "synthetic-long" | "synthetic-short" | "collar";
export interface OptionStructure { kind: StructureKind | string; legs: number[]; contracts: number; side?: "credit" | "debit" | "long" | "short" | string }
export type TradeKind = "single" | "spread" | "roll" | "synthetic" | "pair" | "collar";
export interface OptionTrade { kind: TradeKind | string; size: number; legs: OptionLeg[] }
export interface FundOptionBook {
  fund: string;
  fileDate: string | null;
  stale: boolean;
  refreshed: boolean | null;
  compareDate: string | null;
  legs: OptionLeg[];
  structures: OptionStructure[];
  trades: OptionTrade[];
  tradedLegs: number;
  pairedLegs: number;
  pairedPct: number | null;
}
export interface OptionsByUnderlying {
  underlying: string;
  asOfDate: string;
  fundCount: number;
  legCount: number;
  tradedLegs: number;
  pairedLegs: number;
  pairedPct: number | null;
  funds: FundOptionBook[];
}
