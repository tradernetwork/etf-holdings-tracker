/**
 * Pure logic for the option screens. The activity decoder and the listing filter are
 * ports of the website (etf-dashboard/components/options-table.tsx and
 * app/options-listings/page.tsx): same words, same ordering, same rules.
 */
import { formatStrike, normalizeOptionType } from "@/lib/book";
import type {
  ActivityPeriod,
  FundOptionBook,
  ListingScan,
  ListingEntries,
  OptionActivityRecord,
  OptionLeg,
  OptionStructure,
  OptionTrade,
} from "./types";

// ---- activity ---------------------------------------------------------------------

/** Website PROVIDER_ORDER (etf-dashboard/lib/providers.ts): providers outside it follow, in first-seen order. */
export const PROVIDER_ORDER = [
  "Avantis", "ARK Invest", "Capital Group", "Corgi Funds", "Sprott", "First Trust", "Amplify", "Kurv",
  "YieldMax", "REX Shares", "Roundhill", "Neos", "Global X", "Tidal / NicholasX", "Tidal / NestYield",
];

export interface DecodedOption {
  strategy: "Covered Call" | "Cash-Secured Put";
  directionalView: string;
  moneyness: string;
}

/**
 * The website's decodeOptionSignal, verbatim: a put reads as a cash-secured put ("bullish above the
 * strike"), a call as a covered call ("capping upside at the strike"). It is a heuristic about the
 * fund's usual structure, not a statement about this specific contract; `moneyness` is "likely" for
 * the same reason. Strikes print like the contract title ($135, $219.34): the website prints the raw number, so $366.2 becomes $366.20 here and FLEX decimals are kept.
 */
export function decodeOptionSignal(r: Pick<OptionActivityRecord, "isOption" | "optionDetails" | "currentWeight">): DecodedOption | null {
  if (!r.isOption || !r.optionDetails) return null;
  const type = r.optionDetails.type.toLowerCase();
  const strike = r.optionDetails.strike;
  const moneyness = r.currentWeight > 0 ? "OTM (likely)" : "ATM/ITM";
  if (type.startsWith("p")) return { strategy: "Cash-Secured Put", directionalView: `Bullish above ${formatStrike(strike)}`, moneyness };
  if (type.startsWith("c")) return { strategy: "Covered Call", directionalView: `Capping upside at ${formatStrike(strike)}`, moneyness };
  return null;
}

/** "CC" / "CSP", the website's strategy badge: a call is CC, everything else CSP. */
export const strategyBadge = (r: Pick<OptionActivityRecord, "optionDetails">): "CC" | "CSP" =>
  r.optionDetails?.type.toLowerCase().startsWith("c") ? "CC" : "CSP";

/** NEW -> OPENED, REMOVED -> EXPIRED, anything else ROLLED (the website's labels, kept as is). */
export const signalLabel = (t: OptionActivityRecord["type"]): "OPENED" | "EXPIRED" | "ROLLED" =>
  t === "NEW" ? "OPENED" : t === "REMOVED" ? "EXPIRED" : "ROLLED";

/** "MSTR $135 Call 11/20/26" — underlying, strike, type, expiry. FLEX decimals are kept. */
export function contractLabel(r: Pick<OptionActivityRecord, "optionDetails" | "ticker">): string {
  const d = r.optionDetails;
  if (!d) return r.ticker;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.expiry ?? "");
  const exp = m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : d.expiry;
  return [d.underlying, formatStrike(d.strike), normalizeOptionType(d.type), exp].filter(Boolean).join(" ");
}

const isPut = (r: OptionActivityRecord) => !!r.optionDetails?.type.toLowerCase().startsWith("p");

/** Puts first, then by the size of the weight change (the website's order). */
export function sortActivity(records: OptionActivityRecord[]): OptionActivityRecord[] {
  return [...records].sort((a, b) => {
    const ap = isPut(a), bp = isPut(b);
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    return Math.abs(b.weightDelta) - Math.abs(a.weightDelta);
  });
}

export interface ProviderGroup { provider: string; records: OptionActivityRecord[] }

export function groupByProvider(records: OptionActivityRecord[], providerOf: (fund: string) => string): ProviderGroup[] {
  const map = new Map<string, OptionActivityRecord[]>();
  for (const r of records) {
    const p = providerOf(r.fund);
    map.set(p, [...(map.get(p) ?? []), r]);
  }
  const ordered: ProviderGroup[] = [];
  for (const p of PROVIDER_ORDER) if (map.has(p)) ordered.push({ provider: p, records: map.get(p)! });
  for (const [p, recs] of map) if (!PROVIDER_ORDER.includes(p)) ordered.push({ provider: p, records: recs });
  return ordered;
}

export interface ActivityFilters {
  category: "all" | "active-equity" | "option-income";
  optionType: "all" | "Call" | "Put";
  signal: "all" | "OPENED" | "ROLLED" | "EXPIRED";
  fund: string; // "all" or a fund ticker
  q: string;    // contract / underlying / fund / name
}
/** `?category=` on the activity screen: only the two real fund categories pre-filter, anything else means all. */
export const categoryParam = (v: string | string[] | undefined): ActivityFilters["category"] => {
  const x = Array.isArray(v) ? v[0] : v;
  return x === "option-income" || x === "active-equity" ? x : "all";
};

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = { category: "all", optionType: "all", signal: "all", fund: "all", q: "" };

export function filterActivity(records: OptionActivityRecord[], f: ActivityFilters, categoryOf?: (fund: string) => string | undefined): OptionActivityRecord[] {
  const needle = f.q.trim().toLowerCase();
  return records.filter((r) => {
    if (f.category !== "all" && (r.fundCategory ?? categoryOf?.(r.fund)) !== f.category) return false;
    if (f.optionType !== "all" && normalizeOptionType(r.optionDetails?.type) !== f.optionType) return false;
    if (f.signal !== "all" && signalLabel(r.type) !== f.signal) return false;
    if (f.fund !== "all" && r.fund !== f.fund) return false;
    if (needle) {
      const hay = [r.fund, r.ticker, r.name, r.optionDetails?.underlying ?? "", contractLabel(r)].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export const activeFilterCount = (f: ActivityFilters): number =>
  (f.category !== "all" ? 1 : 0) + (f.optionType !== "all" ? 1 : 0) + (f.signal !== "all" ? 1 : 0) + (f.fund !== "all" ? 1 : 0);

export const PERIOD_LABEL: Record<ActivityPeriod, string> = { daily: "Latest day", weekly: "7 days", monthly: "30 days" };

/** Website weight-Δ cell: raw % with 3 decimals, signed. null/NaN prints "—", never 0. */
export function formatWeightDelta(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(3)}%`;
}

// ---- CBOE listings ----------------------------------------------------------------

export type CatFilter = "all" | "optionable" | "etfs" | "equities";
export const CAT_OPTIONS: { value: CatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "optionable", label: "Newly optionable" },
  { value: "etfs", label: "Weekly ETFs" },
  { value: "equities", label: "Weekly equities" },
];

export type Entry = [string, string];
export interface FilteredScan {
  newOptionable: Entry[]; removedOptionable: Entry[];
  newWeeklyEtfs: Entry[]; removedWeeklyEtfs: Entry[];
  newWeeklyEquities: Entry[]; removedWeeklyEquities: Entry[];
}

/** Port of filterScanEntries: a category other than "all" zeroes the others; search hits symbol or company name. */
export function filterScanEntries(scan: ListingScan, category: CatFilter, search: string): FilteredScan {
  const q = search.trim().toUpperCase();
  const match = (e: Entry) => !q || e[0].toUpperCase().includes(q) || e[1].toUpperCase().includes(q);
  const on = (c: CatFilter) => category === "all" || category === c;
  const pick = (obj: ListingEntries, c: CatFilter): Entry[] => (on(c) ? Object.entries(obj).filter(match) : []);
  return {
    newOptionable: pick(scan.diff.optionable.new, "optionable"),
    removedOptionable: pick(scan.diff.optionable.removed, "optionable"),
    newWeeklyEtfs: pick(scan.diff.weeklyEtfs.new, "etfs"),
    removedWeeklyEtfs: pick(scan.diff.weeklyEtfs.removed, "etfs"),
    newWeeklyEquities: pick(scan.diff.weeklyEquities.new, "equities"),
    removedWeeklyEquities: pick(scan.diff.weeklyEquities.removed, "equities"),
  };
}

export const countNew = (f: FilteredScan) => f.newOptionable.length + f.newWeeklyEtfs.length + f.newWeeklyEquities.length;
export const countRemoved = (f: FilteredScan) => f.removedOptionable.length + f.removedWeeklyEtfs.length + f.removedWeeklyEquities.length;

/** With a filter on, only scans that still have something to show remain (the website's visibleScans). */
export function visibleScans(history: ListingScan[], category: CatFilter, search: string): ListingScan[] {
  const active = category !== "all" || search.trim() !== "";
  return active
    ? history.filter((s) => Object.values(filterScanEntries(s, category, search)).some((a) => a.length > 0))
    : history;
}

export const SCAN_DATE_OPTS = { weekday: "short", month: "short", day: "numeric" } as const;

/** "Sat, Oct 10": the scan's own date in the phone's time zone, as the website does. */
export const scanDateLabel = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", SCAN_DATE_OPTS);
};

// ---- structures (/options/{underlying}) -------------------------------------------

export const STRUCTURE_LABEL: Record<string, string> = {
  "synthetic-long": "Synthetic long",
  "synthetic-short": "Synthetic short",
  "call-spread": "Call spread",
  "put-spread": "Put spread",
  collar: "Collar",
  single: "Single leg",
};
export const STRUCTURE_BLURB: Record<string, string> = {
  "synthetic-long": "A call and a put with the same expiry and size, strikes within 1%: stock-like exposure built from options.",
  "synthetic-short": "A written call and a long put at about the same strike: short-stock exposure from options.",
  "call-spread": "Two calls, same expiry and size, opposite signs.",
  "put-spread": "Two puts, same expiry and size, opposite signs.",
  collar: "A written call with a long put at the same expiry and size.",
  single: "A contract not paired with anything else.",
};
export const TRADE_LABEL: Record<string, string> = {
  roll: "Roll",
  synthetic: "Synthetic",
  spread: "Spread",
  collar: "Collar",
  pair: "Paired change",
  single: "Single change",
};
export const TRADE_BLURB: Record<string, string> = {
  roll: "Same type, different expiry: one leg closing, one opening.",
  synthetic: "A call and a put opened or closed together at about the same strike and expiry.",
  spread: "Same type and expiry, opposite changes.",
  collar: "A call and a put at the same expiry, different strikes.",
  pair: "Equal-size changes that fit no named pattern.",
  single: "A change not paired with anything else.",
};

export const structureLabel = (s: Pick<OptionStructure, "kind" | "side">): string => {
  const base = STRUCTURE_LABEL[s.kind] ?? s.kind;
  if (s.kind === "call-spread" || s.kind === "put-spread") return s.side ? `${base} · ${s.side}` : base;
  if (s.kind === "single" && s.side) return `${base} · ${s.side}`;
  return base;
};

export const legsOfStructure = (book: Pick<FundOptionBook, "legs">, s: OptionStructure): OptionLeg[] =>
  s.legs.map((i) => book.legs[i]).filter((l): l is OptionLeg => !!l);

/** Compact "+576 / −576" change text; null => "—" so an unknown change is never "no change". */
export function formatContractsChange(change: number | null | undefined): string {
  if (change == null || Number.isNaN(change)) return "—";
  if (change === 0) return "no change";
  const n = Math.abs(Math.round(change)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${change > 0 ? "+" : "−"}${n}`;
}

/** A trade's one-line summary, e.g. "Roll · 34,615 contracts". */
export function tradeSummary(t: Pick<OptionTrade, "kind" | "size">): string {
  const n = Math.abs(Math.round(t.size)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${TRADE_LABEL[t.kind] ?? t.kind} · ${n} ${Math.abs(t.size) === 1 ? "contract" : "contracts"}`;
}
