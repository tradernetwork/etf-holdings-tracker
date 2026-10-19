/**
 * Pure view-model for the ticker screen: the headline verdict, the per-fund dollar flow and the
 * zero-data guard. Kept out of the screen so every rule is unit tested.
 */
import type { Change, Moved } from "./types";
import type { TrendSignal } from "./discovery/types";

/** Below this the AUM-blended move prints as "<0.01 pp" (see formatPp), i.e. it carries no signal. */
export const BLENDED_MIN_PP = 0.005;

export interface InstitutionalView {
  signal: TrendSignal;
  /** AUM-blended daily weight change, pp. */
  daily: number | null;
  /** Signed consecutive-session streak: > 0 buying, < 0 selling. */
  streak: number | null;
}

const sign = (n: number | null | undefined): -1 | 0 | 1 => (n == null || n === 0 ? 0 : n > 0 ? 1 : -1);

function trendDirection(i: InstitutionalView): -1 | 0 | 1 {
  const s = sign(i.streak);
  if (s !== 0) return s;
  if (i.signal === "accumulating") return 1;
  if (i.signal === "distributing" || i.signal === "distribution-starting") return -1;
  return 0;
}

/**
 * The headline under the ticker. It follows the AUM-blended institutional signal (the aggregate the
 * exposure card shows). When the per-fund moves or the blended trend disagree with the blended move, or the
 * blended move is too small to print, it says so instead of printing a one-sided verdict the card contradicts.
 * Without institutional data it falls back to the per-fund read.
 */
export function tickerVerdict(input: {
  addedCount: number;
  reducedCount: number;
  institutional?: InstitutionalView | null;
  /** "in the latest file", used when nothing moved at all. */
  quietText: string;
}): string {
  const { addedCount, reducedCount, institutional: inst, quietText } = input;
  const perFund: -1 | 0 | 1 = addedCount > 0 && reducedCount === 0 ? 1 : reducedCount > 0 && addedCount === 0 ? -1 : 0;
  const divided = addedCount > 0 && reducedCount > 0;
  const anyMove = addedCount + reducedCount > 0;
  if (divided) return "A divided book.";
  if (!inst || inst.daily == null) {
    return perFund > 0 ? "Funds are adding." : perFund < 0 ? "Funds are trimming." : quietText;
  }
  if (Math.abs(inst.daily) < BLENDED_MIN_PP) return anyMove ? "Mixed signals." : quietText;
  const agg = sign(inst.daily);
  const trend = trendDirection(inst);
  if ((perFund !== 0 && perFund !== agg) || (trend !== 0 && trend !== agg)) return "Mixed signals.";
  return agg > 0 ? "Funds are adding." : "Funds are trimming.";
}

/** "Opposite moves" only when a fund really moved the other way; otherwise it is just the mover list. */
export const evidenceTitle = (addedCount: number, reducedCount: number): string =>
  addedCount > 0 && reducedCount > 0 ? "Opposite moves" : "Fund moves";

/** A swap line's notional is not a share price. */
const SWAP_NAME = /\b(SWAP|TRS|TOTAL RETURN)\b/i;

/**
 * The fund's own per-share price for this row: its market value divided by its shares. null when it can not be
 * trusted (no market value, no shares, a swap line). Exposure and flow both use THIS price, never weight x AUM.
 */
export function rowPricePerShare(c: Pick<Change, "positionUsd" | "currentShares" | "previousShares" | "name" | "type">): number | null {
  if (SWAP_NAME.test(c.name ?? "")) return null;
  const usd = c.positionUsd;
  const sh = c.currentShares;
  if (usd == null || sh == null || !(usd > 0) || !(sh > 0)) return null;
  return usd / sh;
}

/** Share-based dollar flow: shares traded x the row's own price. null (show nothing) when there is no trustworthy price or no trade. */
export function changeFlowUsd(c: Pick<Change, "positionUsd" | "currentShares" | "previousShares" | "sharesDelta" | "name" | "type">): number | null {
  const price = rowPricePerShare(c);
  if (price == null) return null;
  const d = c.sharesDelta ?? (c.currentShares != null && c.previousShares != null ? c.currentShares - c.previousShares : null);
  if (d == null || d === 0) return null;
  return Math.round(d * price);
}

/** Shares did not change, so any weight move is price drift or creation/redemption renormalisation. */
export function sharesUnchanged(c: Pick<Change, "type" | "sharesDelta" | "currentShares" | "previousShares">): boolean {
  if (c.type === "NEW" || c.type === "REMOVED") return false;
  if (c.sharesDelta != null) return c.sharesDelta === 0;
  return c.currentShares != null && c.previousShares != null && c.currentShares === c.previousShares;
}

/** A ticker page with no reporting fund has nothing to say: never a direction, never a $0 exposure card. */
export const hasReportingFunds = (holdingCount: number): boolean => holdingCount > 0;

export type { Moved };
