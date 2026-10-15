/**
 * Explore's fund directory, as the website's /funds: holdings and option counts, top holding, top move and
 * its add/trim counts, AUM / holdings / A-Z sorts and a combined AUM + provider headline. Pure.
 */
import type { Change, FundSummary } from "./types";

export type FundSort = "aum" | "holdings" | "name";
export const FUND_SORTS: { value: FundSort; label: string }[] = [
  { value: "aum", label: "AUM" },
  { value: "holdings", label: "Holdings" },
  { value: "name", label: "A–Z" },
];

/** /funds rows carry a topHolding the app's older FundSummary type predates. */
export type DirectoryFund = FundSummary & { topHolding?: { ticker: string; weight: number } | null };

export function sortFunds<T extends DirectoryFund>(funds: T[], sort: FundSort): T[] {
  const f = [...funds];
  if (sort === "holdings") return f.sort((a, b) => (b.holdingsCount ?? 0) - (a.holdingsCount ?? 0) || a.fund.localeCompare(b.fund));
  if (sort === "name") return f.sort((a, b) => a.fund.localeCompare(b.fund));
  return f.sort((a, b) => (b.aum ?? 0) - (a.aum ?? 0) || a.fund.localeCompare(b.fund));
}

export interface TopMover { ticker: string; delta: number; type: Change["type"] }

/** Per fund, the equity position whose active weight moved most. Unknown (null, catch-up) deltas are never a move. */
export function buildTopMovers(changes: Change[]): Map<string, TopMover> {
  const map = new Map<string, TopMover>();
  for (const c of changes) {
    if (c.isOption || c.activeWeightDelta == null || c.activeWeightDelta === 0) continue;
    const cur = map.get(c.fund);
    if (!cur || Math.abs(c.activeWeightDelta) > Math.abs(cur.delta)) map.set(c.fund, { ticker: c.ticker, delta: c.activeWeightDelta, type: c.type });
  }
  return map;
}

export interface FundActivity { buys: number; sells: number }

/** Count of equity positions that grew vs shrank in active weight, per fund. */
export function buildFundActivity(changes: Change[]): Map<string, FundActivity> {
  const map = new Map<string, FundActivity>();
  for (const c of changes) {
    if (c.isOption || c.activeWeightDelta == null || c.activeWeightDelta === 0) continue;
    const a = map.get(c.fund) ?? { buys: 0, sells: 0 };
    if (c.activeWeightDelta > 0) a.buys++;
    else a.sells++;
    map.set(c.fund, a);
  }
  return map;
}

/** "42 funds · 7 providers · $18.2B combined AUM" for the visible list. */
export function directoryHeadline(funds: DirectoryFund[]): string {
  const aum = funds.reduce((s, f) => s + (f.aum ?? 0), 0);
  const providers = new Set(funds.map((f) => f.provider)).size;
  const money = aum >= 1 ? `$${aum.toFixed(1)}B` : `$${Math.round(aum * 1000)}M`;
  return `${funds.length} ${funds.length === 1 ? "fund" : "funds"} · ${providers} ${providers === 1 ? "provider" : "providers"} · ${money} combined AUM`;
}

const TICKER_SHAPE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

/**
 * What a search box entry means. A query that is a tracked fund ticker (ARKK) is a FUND: it ranks first and goes to
 * the fund page, and is never offered as a stock lookup (a fund ticker can collide with an option-leg name).
 * Anything else ticker-shaped is a stock lookup.
 */
export function resolveSearch(query: string, funds: { fund: string }[]): { fund: string | null; ticker: string | null } {
  const q = query.trim().toUpperCase();
  if (!q) return { fund: null, ticker: null };
  const fund = funds.find((f) => f.fund.toUpperCase() === q)?.fund ?? null;
  if (fund) return { fund, ticker: null };
  return { fund: null, ticker: TICKER_SHAPE.test(q) ? q : null };
}

/** Exact fund-ticker match first, the rest in their given order. */
export function rankExactFundFirst<T extends { fund: string }>(funds: T[], query: string): T[] {
  const q = query.trim().toUpperCase();
  if (!q) return funds;
  return [...funds].sort((a, b) => Number(b.fund.toUpperCase() === q) - Number(a.fund.toUpperCase() === q));
}
