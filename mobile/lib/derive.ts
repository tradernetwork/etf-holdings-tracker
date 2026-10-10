/**
 * Pure view-model helpers: turn API payloads into what the screens render.
 * Kept free of React so they can be unit tested.
 */
import { resolveUsd, sectorLabel } from "./format";
import type {
  Change,
  Category,
  CategoryChoice,
  FundSummary,
  LayeringPattern,
  SectorFlowRow,
  Signal,
} from "./types";

export const sumActive = (s: Signal): number => s.fundDetails.reduce((a, d) => a + d.activeWeightDelta, 0);

/** Signal has at least one fund opening a brand-new position. */
export const hasNewPosition = (s: Signal): boolean => s.fundDetails.some((d) => d.type === "NEW");

/** Conviction as 0..1 against the strongest signal in the same list (for the thin bar). */
export function convictionFractions(signals: Signal[]): number[] {
  const max = Math.max(0, ...signals.map((s) => s.convictionScore));
  return signals.map((s) => (max > 0 ? Math.max(0, s.convictionScore) / max : 0));
}

/** Count of equity positions added vs reduced today (options excluded). */
export function addReduceCounts(changes: Change[] | undefined): { added: number; reduced: number } | null {
  if (!changes) return null;
  let added = 0;
  let reduced = 0;
  for (const c of changes) {
    if (c.isOption) continue;
    if (c.activeWeightDelta > 0) added++;
    else if (c.activeWeightDelta < 0) reduced++;
  }
  return { added, reduced };
}

/**
 * Sector flow with spelling variants merged ("MATERIALS" + "Materials"), sorted
 * by absolute size. Done here as well as in the API so the app is right even
 * against an API build that predates the sector canonicalisation.
 */
export function mergeSectorFlow(inflows: SectorFlowRow[], outflows: SectorFlowRow[]): SectorFlowRow[] {
  const merged = new Map<string, number>();
  for (const r of [...inflows, ...outflows]) {
    const label = sectorLabel(r.sector);
    if (!label) continue;
    merged.set(label, (merged.get(label) ?? 0) + r.delta);
  }
  return [...merged.entries()]
    .map(([sector, delta]) => ({ sector, delta }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export interface ConsensusCard {
  ticker: string;
  name: string;
  fundCount: number;
  providerCount: number;
  firstEntry: string;
  /** Dollars behind the entries, and whether we had to estimate them. */
  usd: number | null;
  estimated: boolean;
}

/**
 * Layering patterns restricted to the chosen category. The API's layering
 * endpoint has no category filter, so entries are filtered by each fund's
 * category (from /funds) and a pattern only counts if >= minFunds remain.
 */
export function consensusCards(
  patterns: LayeringPattern[],
  funds: FundSummary[] | undefined,
  category: CategoryChoice,
  limit = 3,
  minFunds = 3,
): ConsensusCard[] {
  const catOf = new Map<string, Category>((funds ?? []).map((f) => [f.fund, f.category]));
  const out: ConsensusCard[] = [];
  for (const p of patterns) {
    const entries = p.entrySequence.filter((e) => category === "all" || catOf.get(e.fund) === category);
    if (entries.length < minFunds) continue;
    let known = 0;
    let usd = 0;
    let estimated = false;
    for (const e of entries) {
      const v = resolveUsd({ apiUsd: e.positionUsd, weightPercent: e.weight, aumBillions: e.aum });
      if (v.usd != null) {
        usd += v.usd;
        known++;
        estimated ||= v.estimated;
      }
    }
    out.push({
      ticker: p.ticker,
      name: p.name,
      fundCount: entries.length,
      providerCount: new Set(entries.map((e) => e.provider)).size,
      firstEntry: p.firstEntry,
      usd: known > 0 ? usd : null,
      estimated,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Evidence split for the ticker screen: who added vs who cut (equity rows only). */
export function splitEvidence(changes: Change[]): { added: Change[]; reduced: Change[] } {
  const eq = changes.filter((c) => !c.isOption && c.activeWeightDelta !== 0);
  return {
    added: eq.filter((c) => c.activeWeightDelta > 0).sort((a, b) => b.activeWeightDelta - a.activeWeightDelta),
    reduced: eq.filter((c) => c.activeWeightDelta < 0).sort((a, b) => a.activeWeightDelta - b.activeWeightDelta),
  };
}

/** A fund's own changes only: the API's fund payload must never leak another fund's rows. */
export const changesForFund = (changes: Change[], fund: string): Change[] =>
  changes
    .filter((c) => c.fund === fund && !c.isOption)
    .sort((a, b) => Math.abs(b.activeWeightDelta) - Math.abs(a.activeWeightDelta));
