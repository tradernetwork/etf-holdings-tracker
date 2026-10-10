/**
 * Pure view-model helpers: turn API payloads into what the screens render.
 * Kept free of React so they can be unit tested.
 */
import { formatPp, formatShares, resolveUsd, sectorLabel } from "./format";
import { isSignificant, partitionSignificant } from "./significance";
import type {
  Change,
  Category,
  CategoryChoice,
  Divergence,
  FundSummary,
  LayeringPattern,
  SectorFlowRow,
  Signal,
  SignalsResponse,
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
  /** Funds that entered, in entry order. */
  funds: string[];
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
      funds: entries.map((e) => e.fund),
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

// ---- Home hero + evidence -------------------------------------------------------

/**
 * One plain-English line under an evidence card, explaining why the active-weight
 * figure can differ from what the raw numbers suggest.
 */
export function evidenceNote(c: Change): string {
  if (c.activeWeightDelta < 0 && c.weightDelta > 0) {
    return `Raw weight rose ${formatPp(c.weightDelta)}. Price drift can hide a relative reduction.`;
  }
  if (c.sharesDelta === 0) return "Reported share count unchanged. Active weight removes price drift.";
  if (c.sharesDelta != null) {
    return `Reported share change: ${formatShares(c.sharesDelta)}. Active weight removes price drift.`;
  }
  return "Active weight removes price drift from the raw weight change.";
}

export interface HeroSide {
  fund: string;
  delta: number;
}
export interface HeroStory {
  ticker: string;
  name: string;
  sector: string;
  /** True when funds trade this name in opposite directions. */
  countercase: boolean;
  added: HeroSide[];
  reduced: HeroSide[];
  /** Consecutive sessions in the headline direction, if the API reports it. */
  streak: { days: number; direction: "buying" | "selling" } | null;
}

/**
 * The top story for the Home hero: the strongest divergence if there is one
 * (a name one fund added while another reduced it), otherwise the top buy.
 * Everything shown is taken from the payloads; nothing is invented.
 */
export function pickHero(divergences: Divergence[] | undefined, signals: SignalsResponse | undefined): HeroStory | null {
  const all = [...(signals?.signals.buying ?? []), ...(signals?.signals.selling ?? [])];
  const sig = (t: string) => all.find((s) => s.ticker === t);
  const sectorFor = (t: string) =>
    sig(t)?.sector || signals?.changes.find((c) => c.ticker === t && c.sector)?.sector || "";

  // A countercase only counts when BOTH sides pass the API's significance rule;
  // a -0.00x pp "reduction" is price drift, not opposition.
  const sigSides = (fs: { fund: string; weightDelta: number }[]) => fs.filter((f) => isSignificant(f.fund, f.weightDelta));
  const d = divergences?.find((x) => sigSides(x.buyingFunds).length > 0 && sigSides(x.sellingFunds).length > 0);
  if (d) {
    const s = sig(d.ticker);
    return {
      ticker: d.ticker,
      name: d.name,
      sector: sectorFor(d.ticker),
      countercase: true,
      added: sigSides(d.buyingFunds).slice(0, 1).map((f) => ({ fund: f.fund, delta: f.weightDelta })),
      reduced: sigSides(d.sellingFunds).slice(0, 1).map((f) => ({ fund: f.fund, delta: f.weightDelta })),
      streak: s?.streak ? { days: s.streak, direction: s.direction } : null,
    };
  }
  const top = signals?.signals.buying[0];
  if (!top) return null;
  const rows = top.fundDetails
    .filter((f) => isSignificant(f.fund, f.activeWeightDelta))
    .map((f) => ({ fund: f.fund, delta: f.activeWeightDelta }));
  return {
    ticker: top.ticker,
    name: top.name,
    sector: top.sector,
    countercase: false,
    added: rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 2),
    reduced: rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 1),
    streak: top.streak ? { days: top.streak, direction: top.direction } : null,
  };
}

export interface WorthRow {
  ticker: string;
  title: string;
  sub: string;
  delta: number;
}

/** "Also worth a look": the next strongest moves after the hero, buys and sells interleaved. */
export function alsoWorthLook(signals: SignalsResponse | undefined, excludeTicker: string | undefined, limit = 4): WorthRow[] {
  const buys = (signals?.signals.buying ?? []).filter((s) => s.ticker !== excludeTicker);
  const sells = (signals?.signals.selling ?? []).filter((s) => s.ticker !== excludeTicker);
  const picked: Signal[] = [];
  for (let i = 0; picked.length < limit && (i < buys.length || i < sells.length); i++) {
    if (buys[i]) picked.push(buys[i]);
    if (picked.length < limit && sells[i]) picked.push(sells[i]);
  }
  return picked.map((s) => {
    const entrant = s.fundDetails.find((f) => f.type === "NEW");
    const up = s.direction === "buying";
    return {
      ticker: s.ticker,
      title: entrant ? "A new position" : up ? "Allocation increased" : "Allocation reduced",
      sub: entrant ? `${entrant.fund} entered ${s.ticker}` : `${s.fundCount} ${s.fundCount === 1 ? "fund" : "funds"} · ${s.providerCount} ${s.providerCount === 1 ? "provider" : "providers"}`,
      delta: sumActive(s),
    };
  });
}

/**
 * Ticker evidence: equity changes split into significant added/reduced moves
 * (per the API's thresholds) and a pile of smaller adjustments.
 */
export function tickerEvidence(changes: Change[]): { added: Change[]; reduced: Change[]; minor: Change[] } {
  const eq = changes.filter((c) => !c.isOption && c.activeWeightDelta !== 0);
  const { significant, minor } = partitionSignificant(eq);
  return {
    added: significant.filter((c) => c.activeWeightDelta > 0).sort((a, b) => b.activeWeightDelta - a.activeWeightDelta),
    reduced: significant.filter((c) => c.activeWeightDelta < 0).sort((a, b) => a.activeWeightDelta - b.activeWeightDelta),
    minor: minor.sort((a, b) => Math.abs(b.activeWeightDelta) - Math.abs(a.activeWeightDelta)),
  };
}
