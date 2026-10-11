/**
 * Dated option activity (website: components/option-activity.tsx), as pure functions. Built from CONTRACT
 * changes, paired into what each trade is: a roll, a spread, a synthetic, a collar, a pair or a lone change.
 */
import { formatCount } from "./format";
import type { ActivityLeg, OptionActivityDay, OptionTrade } from "./fundExtras";

/** "Fri, Oct 9", parsed as a UTC date so it never drifts a day. */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function shortDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : (iso ?? "—");
}

/** "152.5C 10/16/26". */
export function legName(l: ActivityLeg): string {
  return `${l.strike ?? "?"}${l.optionType === "PUT" ? "P" : "C"} ${shortDate(l.expiry)}`;
}

const signed = (v: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatCount(v)}`;
/** "+34,615 (0 → 34,615)", optionally with a FLEX marker. */
export function legChange(l: ActivityLeg): string {
  return `${legName(l)} ${signed(l.change)} (${formatCount(l.prevContracts)} → ${formatCount(l.contracts)})${l.isFlex ? " FLEX" : ""}`;
}

export const ACTION_LABEL: Record<string, string> = { open: "Opened", close: "Closed", expired: "Expired", add: "Added", reduce: "Reduced", flip: "Flipped" };

/** Opened / closed / resized, for a paired structure. */
export function lifecycle(legs: ActivityLeg[]): string {
  if (legs.every((l) => !l.prevContracts)) return "opened";
  if (legs.every((l) => !l.contracts)) return "closed";
  return "resized";
}

export interface TradeText {
  badge: string;
  /** Style key: roll / spread / synthetic / collar / pair or the single's action. */
  tone: string;
  /** Roll only: the leg that was closed and the one opened, shown as "from → to". */
  from?: string;
  to?: string;
  text: string;
}

export function describeTrade(t: OptionTrade): TradeText {
  const legs = t.legs;
  const [a, b] = legs;
  switch (t.kind) {
    case "roll": {
      const from = legs.find((l) => l.change !== 0 && Math.abs(l.contracts) < Math.abs(l.prevContracts)) ?? a;
      const to = legs.find((l) => l !== from) ?? b;
      const side = (to.contracts || from.prevContracts) < 0 ? "written" : "long";
      return { badge: "Roll", tone: "roll", from: legName(from), to: legName(to), text: `${legName(from)} → ${legName(to)} · ${side}` };
    }
    case "spread": {
      const short = legs.find((l) => (l.contracts || l.prevContracts) < 0) ?? a;
      const long = legs.find((l) => l !== short) ?? b;
      const call = short.optionType === "CALL";
      const credit = call ? (short.strike ?? 0) < (long.strike ?? 0) : (short.strike ?? 0) > (long.strike ?? 0);
      return { badge: "Spread", tone: "spread", text: `${shortDate(short.expiry)} ${short.strike}/${long.strike} ${call ? "call" : "put"} spread · ${credit ? "credit" : "debit"} · ${lifecycle(legs)}` };
    }
    case "synthetic": {
      const call = legs.find((l) => l.optionType === "CALL") ?? a;
      const long = (call.contracts || -call.prevContracts) > 0 || call.change > 0;
      return { badge: "Synthetic", tone: "synthetic", text: `${shortDate(call.expiry)} ${call.strike} synthetic ${long ? "long" : "short"} (stock exposure) · ${lifecycle(legs)}` };
    }
    case "collar": {
      const c = legs.find((l) => l.optionType === "CALL") ?? a;
      const p = legs.find((l) => l.optionType === "PUT") ?? b;
      return { badge: "Collar", tone: "collar", text: `${shortDate(c.expiry)} ${c.strike}C / ${p.strike}P collar · ${lifecycle(legs)}` };
    }
    case "pair":
      return { badge: "Pair", tone: "pair", text: `${legs.map(legName).join(" + ")} · equal size, no standard shape` };
    default: {
      const side = (a.contracts || a.prevContracts) < 0 ? "written" : "long";
      return { badge: ACTION_LABEL[t.action ?? ""] ?? "Change", tone: t.action ?? "pair", text: `${legName(a)} · ${side}` };
    }
  }
}

const NOUN: Record<string, [string, string]> = {
  roll: ["roll", "rolls"], spread: ["spread", "spreads"], synthetic: ["synthetic", "synthetics"],
  collar: ["collar", "collars"], pair: ["other pair", "other pairs"],
};

/** "14 rolls · 5 expired · 3 opened": structures pluralise, actions don't. */
export function activitySummary(days: OptionActivityDay[]): string[] {
  const counts: Record<string, number> = {};
  for (const d of days) {
    for (const t of d.trades) {
      const k = t.kind === "single" ? (t.action ?? "change") : t.kind;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${NOUN[k] ? NOUN[k][n === 1 ? 0 : 1] : (ACTION_LABEL[k] ?? k).toLowerCase()}`);
}

/** One day's header status: the carried-forward case must say so, never "no trades". */
export function dayStatus(d: OptionActivityDay): string {
  if (d.refreshed === false) return "not refreshed: issuer file unavailable";
  if (d.trades.length === 0) return "no option trades";
  return `${d.trades.length} trade${d.trades.length === 1 ? "" : "s"}`;
}
