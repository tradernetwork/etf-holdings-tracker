/**
 * The income directory (/api/v1/income): every option-income fund, grouped by what it structurally is.
 * Types, fetcher and the pure grouping/formatting rules live here; the website's /income page is the spec.
 */
import { ApiError, NetworkError } from "./api";
import { fetchWithRetry } from "./retry";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

export type ArchetypeKey = "covered-call" | "synthetic" | "leap-proxy" | "short-equity" | "swap" | "unknown";

export interface IncomeTiles {
  callCoveragePct: number | null;
  weightedMoneynessPct: number | null;
  weightedDte: number | null;
  upsideRoomPct: number | null;
  cappedNames: number;
  namesWithWrittenCalls: number;
  collateralPct: number | null;
  callNotionalPctNav: number | null;
  putNotionalPctNav: number | null;
  writtenCallLegs: number;
  writtenLegs: number;
}
/** Percent of net assets, signed: written options subtract. */
export interface IncomeSleeves {
  equity: number;
  treasury: number;
  cash: number;
  swap: number;
  optionsLong: number;
  optionsShort: number;
}
export interface IncomeDirectoryFund {
  fund: string;
  provider: string;
  aum: number | null; // billions
  aumUsd?: number | null;
  archetype: ArchetypeKey | string;
  archetypeLabel: string;
  archetypeSummary: string;
  sleeves: IncomeSleeves;
  counts: { equityPositions: number; optionLegs: number; underlyings: number };
  tiles: IncomeTiles;
  /** False when the income leg is written and expires within one session (never in an end-of-day file). */
  incomeLegVisible: boolean;
}
export interface IncomeArchetype {
  key: ArchetypeKey | string;
  label: string;
  summary: string;
  funds: string[];
}
export interface IncomeDirectory {
  asOfDate: string;
  fundCount: number;
  archetypes: IncomeArchetype[];
  funds: IncomeDirectoryFund[];
}

export async function fetchIncomeDirectory(signal?: AbortSignal): Promise<IncomeDirectory> {
  let res: Response;
  try {
    res = await fetchWithRetry(fetch, `${API_BASE}/api/v1/income`, { signal, headers: { Accept: "application/json", "X-TickerTrace-Client": "app" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new NetworkError(e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as IncomeDirectory;
}

// ---- display rules (mirror etf-dashboard/app/income/page.tsx) ----------------------------

/** Covered-call funds first (the reader's mental model of "income ETF"); the further down, the more the page explains what's missing. */
export const ARCHETYPE_ORDER: string[] = ["covered-call", "synthetic", "leap-proxy", "short-equity", "swap", "unknown"];

export const INVISIBLE_INCOME_LEG =
  "Income leg not visible in holdings data — contracts are written and expire in the same session, so no end-of-day file ever contains one. We can show what this fund owns, not what it sold.";

/** "Oct 9, 2026". */
export function formatAsOfLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const pct = (v: number | null | undefined, digits = 1): string => (v == null ? "—" : `${v.toFixed(digits)}%`);

/** Signed percent for sleeves ("+12.3%" / "−7.5%"); zero shows as 0.0%. */
export const signedPct = (v: number): string => (v === 0 ? "0.0%" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);

export type Tone = "muted" | "sell" | "income" | "buy" | "plain";
/** Written at/above spot means the upside is already sold. */
export function moneynessTone(v: number | null): Tone {
  if (v === null) return "muted";
  if (v > 0) return "sell";
  if (v > -3) return "income";
  return "buy";
}
export const moneynessSub = (v: number | null): string => (v === null ? "no spot data" : v > 0 ? "in the money" : "out of the money");
export const dteSub = (d: number | null): string => (d === null ? "" : d < 3 ? "daily cycle" : d < 10 ? "weekly cycle" : "monthly+");
export const cappedTone = (f: Pick<IncomeTiles, "cappedNames">): Tone => (f.cappedNames > 0 ? "sell" : "plain");

export function formatAum(billions: number | null | undefined): string {
  if (!billions) return "";
  return billions >= 1 ? `$${billions.toFixed(2)}B` : `$${Math.round(billions * 1000)}M`;
}

export interface ArchetypeSection {
  key: string;
  label: string;
  summary: string;
  funds: IncomeDirectoryFund[];
}

export type DirectorySort = "aum" | "coverage" | "dte" | "name";
export const SORT_OPTIONS: { value: DirectorySort; label: string }[] = [
  { value: "aum", label: "AUM" },
  { value: "coverage", label: "Coverage" },
  { value: "dte", label: "DTE" },
  { value: "name", label: "A–Z" },
];

/** Funds with no value for the sort key go last, whatever the direction. */
export function sortFunds(funds: IncomeDirectoryFund[], key: DirectorySort): IncomeDirectoryFund[] {
  const num = (f: IncomeDirectoryFund): number | null =>
    key === "aum" ? f.aum ?? null : key === "coverage" ? f.tiles.callCoveragePct : key === "dte" ? f.tiles.weightedDte : null;
  return [...funds].sort((a, b) => {
    if (key === "name") return a.fund.localeCompare(b.fund);
    const x = num(a), y = num(b);
    if (x === null && y === null) return a.fund.localeCompare(b.fund);
    if (x === null) return 1;
    if (y === null) return -1;
    // AUM and coverage read biggest-first; DTE reads shortest-cycle-first.
    return (key === "dte" ? x - y : y - x) || a.fund.localeCompare(b.fund);
  });
}

/** Sections in website order; unknown archetype keys from a newer server are appended rather than dropped. */
export function groupByArchetype(d: IncomeDirectory, opts: { archetype?: string | "all"; sort?: DirectorySort } = {}): ArchetypeSection[] {
  const byKey = new Map<string, IncomeDirectoryFund[]>();
  for (const f of d.funds) byKey.set(f.archetype, [...(byKey.get(f.archetype) ?? []), f]);
  const keys = [...ARCHETYPE_ORDER.filter((k) => byKey.has(k)), ...[...byKey.keys()].filter((k) => !ARCHETYPE_ORDER.includes(k))];
  return keys
    .filter((k) => !opts.archetype || opts.archetype === "all" || k === opts.archetype)
    .map((k) => {
      const meta = d.archetypes.find((a) => a.key === k);
      const sample = byKey.get(k)![0];
      return {
        key: k,
        label: meta?.label ?? sample.archetypeLabel ?? k,
        summary: meta?.summary ?? sample.archetypeSummary ?? "",
        funds: sortFunds(byKey.get(k)!, opts.sort ?? "aum"),
      };
    });
}
