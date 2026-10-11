/**
 * The option-income "Positions" view (website: components/fund-positions.tsx), as pure functions:
 * one row per stock (held outright and/or synthetically) with its option legs, covered/uncovered
 * split, filters, nine sorts and an expiry ladder. Every rule below is copied from the website so
 * the two clients show the same book.
 */
import { optionKey } from "./book";
import { sectorLabel } from "./format";
import type { IncomePosition, OptionActivityDay, PositionLeg } from "./fundExtras";
import type { Change } from "./types";

export const UNCLASSIFIED = "Unclassified";

export const ROLE_LABEL: Record<PositionLeg["role"], string> = {
  "written-call": "Written call",
  "written-put": "Written put",
  "long-call": "Long call",
  "long-put": "Long put",
  synthetic: "Synthetic stock",
};

export interface PosRow {
  p: IncomePosition;
  sector: string;
  /** Today's share change from the fund's daily diff. null = unchanged / unknown. */
  sharesDelta: number | null;
  isNew: boolean;
  /** Upside room to the nearest-dated live written call. */
  upside: number | null;
  /** A written call is in the money. */
  itm: boolean;
  /** Soonest DTE among live written legs (the income book, not synthetics). */
  dte: number | null;
  navPct: number;
}

/** Share change for a stock from its equity Change row: NEW = the whole position, CHANGED = the delta. */
export function sharesDeltaOf(change: Change | undefined): number | null {
  if (!change) return null;
  if (change.type === "NEW") return change.currentShares ?? null;
  if (change.type === "CHANGED" && change.sharesDelta) return change.sharesDelta;
  return null;
}

export function deriveRow(p: IncomePosition, change: Change | undefined): PosRow {
  const liveWritten = p.legs.filter((l) => !l.expired && (l.role === "written-call" || l.role === "written-put"));
  const calls = liveWritten.filter((l) => l.role === "written-call");
  const nearestCall = calls.reduce<PositionLeg | null>(
    (best, l) => (best === null || (l.dte ?? Infinity) < (best.dte ?? Infinity) ? l : best), null);
  const dtes = liveWritten.map((l) => l.dte).filter((d): d is number => d != null);
  return {
    p,
    sector: p.sector ? sectorLabel(p.sector) : UNCLASSIFIED,
    sharesDelta: sharesDeltaOf(change),
    isNew: change?.type === "NEW",
    upside: nearestCall?.upsideRoomPct ?? null,
    itm: calls.some((l) => l.upsideRoomPct != null && l.upsideRoomPct < 0),
    dte: dtes.length ? Math.min(...dtes) : null,
    navPct: p.exposurePctNav ?? p.weight,
  };
}

/** Rows for the stock positions (a position with no shares, real or synthetic, is "options only"). */
export function deriveRows(positions: IncomePosition[], equityChanges: Change[]): PosRow[] {
  const byTicker = new Map(equityChanges.filter((c) => !c.isOption).map((c) => [c.ticker.toUpperCase(), c]));
  return positions.filter((p) => p.totalShares !== 0).map((p) => deriveRow(p, byTicker.get(p.ticker.toUpperCase())));
}

/** Positions that carry option legs but no stock ("Options without a stock position"). */
export const optionOnlyPositions = (positions: IncomePosition[]): IncomePosition[] =>
  positions.filter((p) => p.totalShares === 0 && p.legs.length > 0);

// ---- filters and sorts --------------------------------------------------------------

export type PosSort = "symbol" | "qty" | "price" | "value" | "nav" | "delta" | "coverage" | "upside" | "dte";
export type Coverage = "all" | "full" | "partial" | "none";
export type Toggle = "synthetic" | "itm" | "expiring" | "changed";

export const SORT_LABEL: Record<PosSort, string> = {
  symbol: "Symbol", qty: "Qty", price: "Price", value: "Mkt value", nav: "% NAV", delta: "Δ today", coverage: "Covered", upside: "Upside room", dte: "DTE",
};
export const COVERAGE_LABEL: Record<Coverage, string> = { all: "All", full: "Covered", partial: "Partly covered", none: "Uncovered" };
export const TOGGLE_LABEL: Record<Toggle, string> = { synthetic: "Synthetic", itm: "Call in the money", expiring: "Expiring ≤ 7d", changed: "Changed today" };

/** The direction a sort starts in: text and "soonest" columns ascending, money columns biggest-first. */
export const DEFAULT_DIR: Record<PosSort, "asc" | "desc"> = {
  symbol: "asc", qty: "desc", price: "desc", value: "desc", nav: "desc", delta: "desc", coverage: "asc", upside: "asc", dte: "asc",
};

const SORT_VALUE: Record<PosSort, (r: PosRow) => number | string | null> = {
  symbol: (r) => r.p.ticker,
  qty: (r) => r.p.totalShares,
  price: (r) => r.p.price,
  value: (r) => r.p.exposureValue,
  nav: (r) => r.navPct,
  delta: (r) => r.sharesDelta,
  coverage: (r) => r.p.coveragePct,
  upside: (r) => r.upside,
  dte: (r) => r.dte,
};

export interface PosFilters {
  cov: Coverage;
  toggles: Set<Toggle>;
  sector: string;
  q: string;
}
export const NO_FILTERS: PosFilters = { cov: "all", toggles: new Set(), sector: "", q: "" };
export const filtersActive = (f: PosFilters): boolean => f.cov !== "all" || f.toggles.size > 0 || !!f.sector || !!f.q.trim();

export function filterRows(rows: PosRow[], f: PosFilters): PosRow[] {
  const needle = f.q.trim().toUpperCase();
  return rows.filter((r) => {
    const c = r.p.coveragePct ?? 0;
    if (f.cov === "full" && c < 90) return false;
    if (f.cov === "partial" && !(c > 0 && c < 90)) return false;
    if (f.cov === "none" && c > 0) return false;
    if (f.toggles.has("synthetic") && r.p.syntheticShares === 0) return false;
    if (f.toggles.has("itm") && !r.itm) return false;
    if (f.toggles.has("expiring") && !(r.dte != null && r.dte <= 7)) return false;
    if (f.toggles.has("changed") && r.sharesDelta == null) return false;
    if (f.sector && r.sector !== f.sector) return false;
    if (needle && !r.p.ticker.toUpperCase().includes(needle) && !r.p.name.toUpperCase().includes(needle)) return false;
    return true;
  });
}

/** Missing values always sink, whichever way the column is sorted. */
export function sortRows(rows: PosRow[], sort: PosSort, dir: "asc" | "desc" = DEFAULT_DIR[sort]): PosRow[] {
  const get = SORT_VALUE[sort];
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") return sign * String(va).localeCompare(String(vb));
    return sign * (va - vb);
  });
}

export function sectorsOf(rows: PosRow[]): string[] {
  return [...new Set(rows.map((r) => r.sector))].sort((a, b) => (a === UNCLASSIFIED ? 1 : b === UNCLASSIFIED ? -1 : a.localeCompare(b)));
}

/** Largest sector by stock exposure (Unclassified excluded). */
export function topSector(rows: PosRow[]): string | null {
  const by = new Map<string, number>();
  for (const r of rows) if (r.sector !== UNCLASSIFIED) by.set(r.sector, (by.get(r.sector) ?? 0) + r.p.exposureValue);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export const liveLegCount = (positions: IncomePosition[]): number => positions.reduce((n, p) => n + p.legs.filter((l) => !l.expired).length, 0);

// ---- expiry ladder --------------------------------------------------------------------

export interface LadderGroup {
  expiry: string;
  dte: number | null;
  legs: { ticker: string; leg: PositionLeg }[];
}

/** Live legs of the (filtered) rows grouped by expiry, soonest first. Expired legs are excluded. */
export function expiryLadder(rows: PosRow[]): LadderGroup[] {
  const m = new Map<string, { ticker: string; leg: PositionLeg }[]>();
  for (const r of rows) {
    for (const leg of r.p.legs) {
      if (leg.expired) continue;
      m.set(leg.expiry, [...(m.get(leg.expiry) ?? []), { ticker: r.p.ticker, leg }]);
    }
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([expiry, legs]) => ({ expiry, dte: legs[0]?.leg.dte ?? null, legs }));
}

// ---- opened dates ---------------------------------------------------------------------

/** When a leg first appeared, from the dated activity timeline. Older legs have no date rather than a wrong one. */
export function openedDates(days: OptionActivityDay[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of [...(days ?? [])].reverse()) { // oldest first, so a reopened leg keeps its latest open date
    for (const t of d.trades) {
      for (const l of t.legs) {
        if (!l.prevContracts && l.contracts) m.set(optionKey(t.underlying, l.optionType, l.strike, l.expiry), d.date);
      }
    }
  }
  return m;
}

/** "opened 10/6". */
export function openedLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `opened ${Number(m[2])}/${Number(m[3])}` : `opened ${iso}`;
}

// ---- per-row text ---------------------------------------------------------------------

/** "1,000 held + 7,596,500 synthetic" / "all synthetic" / "short" / null. */
export function qtyNote(p: IncomePosition): string | null {
  const n = (v: number) => Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (p.syntheticShares !== 0) return p.sharesHeld !== 0 ? `${n(p.sharesHeld)} held + ${n(p.syntheticShares)} synthetic` : "all synthetic";
  return p.totalShares < 0 ? "short" : null;
}

/** "5 DTE · opened 10/6 · 3.4% upside room" / "ITM by 1.2%". */
export function legMeta(leg: PositionLeg, opened?: string): string {
  return [
    leg.expired ? "expired" : leg.dte != null ? `${Math.round(leg.dte)} DTE` : null,
    opened ? openedLabel(opened) : null,
    leg.upsideRoomPct != null ? (leg.upsideRoomPct >= 0 ? `${leg.upsideRoomPct.toFixed(1)}% upside room` : `ITM by ${Math.abs(leg.upsideRoomPct).toFixed(1)}%`) : null,
  ].filter(Boolean).join(" · ");
}

// ---- coverage class and data notices ------------------------------------------------

export type CoverageClass = "full" | "partial" | "none";
/** Same buckets as the coverage filter: >=90 covered, (0,90) partly, else uncovered (unknown counts as none). */
export const coverageClass = (pct: number | null | undefined): CoverageClass => {
  const c = pct ?? 0;
  return c >= 90 ? "full" : c > 0 ? "partial" : "none";
};
export const COVERAGE_CLASS_LABEL: Record<CoverageClass, string> = { full: "Covered", partial: "Partly covered", none: "Uncovered" };

export interface Notice {
  key: string;
  tone: "warn" | "info";
  title: string;
  body: string;
}

/**
 * Data the website states as part of the page (not footnotes): the invisible intraday-income-leg disclosure
 * and the quote-suppressed spot warning. Wording follows app/income/[fund] and fund-positions.
 */
export function incomeNotices(inc: { fund: string; incomeLegVisible?: boolean; positions?: IncomePosition[] } | undefined): Notice[] {
  if (!inc) return [];
  const out: Notice[] = [];
  if (inc.incomeLegVisible === false) {
    out.push({
      key: "invisible",
      tone: "warn",
      title: "We can show you what this fund owns. We cannot show you what it sold.",
      body: `${inc.fund} writes contracts that open and expire inside a single session. An end-of-day holdings file, which is all any fund publishes, structurally cannot contain one. Across every snapshot we hold, this fund has shown zero written options. That's the strategy working as designed, not a gap in our data. The long exposure below is real; the income leg is invisible to everyone, including us.`,
    });
  }
  if ((inc.positions ?? []).some((p) => p.spotSuppressed)) {
    const names = inc.positions!.filter((p) => p.spotSuppressed).map((p) => p.ticker).join(", ");
    out.push({
      key: "suppressed",
      tone: "warn",
      title: "Quote suppressed",
      body: `For ${names}, the fund's own mark and our quote feed disagree by more than 5%, so we suppress the derived numbers (price, coverage math) rather than show them wrong.`,
    });
  }
  return out;
}

/** Message when there is no stock book to measure coverage against. */
export const noCoverageMessage = (incomeLegVisible: boolean | undefined): string =>
  incomeLegVisible === false
    ? "This fund writes its income options intraday, so they never appear in an end-of-day holdings file. Coverage cannot be measured."
    : "No stock position to cover in the latest snapshot.";
