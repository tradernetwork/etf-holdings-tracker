/** Pure helpers for the complete Today screens. */
import { formatUsd } from "@/lib/format";
import type { FullSignal, SectorFlowEntry, SignalFund, TodayStats } from "./types";

/**
 * Whole weekdays between the data date and `now` (UTC), the website's businessDaysBehind. Over 1 means
 * the scrape or sync is late, which the website flags with an amber ⚠ on "LAST UPDATED".
 */
export function businessDaysBehind(asOf: string | null | undefined, now: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOf ?? "");
  if (!m) return 0;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let days = 0;
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) days++;
  }
  return days;
}

export const isStaleAsOf = (asOf: string | null | undefined, now?: Date): boolean => businessDaysBehind(asOf, now) > 1;

export function staleMessage(asOf: string | null | undefined, now?: Date): string | null {
  const lag = businessDaysBehind(asOf, now);
  return lag > 1 ? `Data is ${lag} business days stale. The scraper or the box sync may be delayed.` : null;
}

export interface Kpi { key: string; label: string; value: string; blurb: string }

/** The website's KPI bar: Funds Tracked, Stocks, P/C Ratio, plus New / Exits Today and the options contract count. */
export function kpis(s: TodayStats | undefined): Kpi[] {
  if (!s) return [];
  const out: Kpi[] = [
    { key: "funds", label: "Funds tracked", value: s.fundsTracked.toLocaleString("en-US"), blurb: "Institutional ETFs whose full holdings are normalized every trading day." },
    { key: "stocks", label: "Stocks", value: s.uniqueTickers.toLocaleString("en-US"), blurb: "Unique stocks held across all tracked ETFs today, deduplicated across the whole institutional book." },
    { key: "pc", label: "Put/call ratio", value: s.putCallRatio == null ? "—" : String(s.putCallRatio), blurb: "Option put contracts divided by call contracts across tracked funds. Above 1.0 leans bearish hedging; below 1.0 leans call exposure." },
  ];
  if (s.optionsContracts != null) out.push({ key: "opts", label: "Option contracts", value: s.optionsContracts.toLocaleString("en-US"), blurb: "Option legs held across the tracked funds." });
  if (s.newPositionsToday != null) out.push({ key: "new", label: "New today", value: String(s.newPositionsToday), blurb: "Brand-new fund positions opened today: a tracked fund went from 0 to holding something." });
  if (s.exitsToday != null) out.push({ key: "exits", label: "Exits today", value: String(s.exitsToday), blurb: "Positions fully closed today: a tracked fund went from holding to zero." });
  return out;
}

/** inflows + outflows as one list, biggest absolute move first (nothing capped). */
export function allSectorFlow(flow: { inflows: SectorFlowEntry[]; outflows: SectorFlowEntry[] } | undefined): SectorFlowEntry[] {
  if (!flow) return [];
  return [...flow.inflows, ...flow.outflows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** "conv 8.9": the website prints the score with one decimal. */
export const convText = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? "conv —" : `conv ${n.toFixed(1)}`);

/** "+1.08 pp across 2 funds from 2 providers". */
export function signalSummary(s: Pick<FullSignal, "totalWeightDelta" | "fundCount" | "providerCount">): string {
  const sign = s.totalWeightDelta > 0 ? "+" : s.totalWeightDelta < 0 ? "−" : "";
  return `${sign}${Math.abs(s.totalWeightDelta).toFixed(2)} pp across ${s.fundCount} ${s.fundCount === 1 ? "fund" : "funds"} from ${s.providerCount} ${s.providerCount === 1 ? "provider" : "providers"}`;
}

/** The fund's dollar size from the API's own field, else its weight x AUM ($B): labelled by the caller as an estimate. */
export function fundPositionUsd(f: Pick<SignalFund, "currentWeight" | "aumUsd" | "aum">): number | null {
  const aum = f.aumUsd ?? (f.aum != null ? f.aum * 1e9 : null);
  return aum == null ? null : Math.round((f.currentWeight / 100) * aum);
}

export const usdOrDash = (v: number | null | undefined): string => (v == null ? "—" : formatUsd(v));

/** Direction of a consecutive-day streak from the briefing: "9d ↑". */
export const streakLabel = (days: number, direction: "up" | "down"): string => `${days}d ${direction === "up" ? "↑" : "↓"}`;

/** The streak on a signal (signed in the API? it is a count): "9-day streak" or null. */
export const signalStreak = (s: Pick<FullSignal, "streak">): string | null =>
  s.streak != null && s.streak !== 0 ? `${Math.abs(s.streak)}-day streak` : null;

/** Layering strength as the website's 0-100 integer. */
export const strengthText = (n: number): string => String(Math.round(n));
