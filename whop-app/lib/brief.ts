/**
 * Builds the text a creator broadcasts to their community. The broadcast is
 * delivered as a Whop push notification (which reaches every member of the
 * experience with no target selection, so it needs no stored config), and the
 * notification deep-links recipients into the live Signals tab.
 *
 * `briefText` is the full human-readable rundown shown to the creator in the
 * composer so they can see exactly what they're alerting people about; the
 * push itself carries `pushTitle` + a short summary. Pure string-building —
 * no I/O, no persistence — so the action can fetch fresh data at send time.
 */
import type { ApiFullPayload, ApiSignal } from "./api";
import { pct } from "./format";

/** One signal row as a bullet, e.g. "• TSLA  +1.23%  · 4 funds, 2 providers". */
function signalLine(s: ApiSignal): string {
  const funds = `${s.fundCount} fund${s.fundCount === 1 ? "" : "s"}`;
  const provs = `${s.providerCount} provider${s.providerCount === 1 ? "" : "s"}`;
  const streak = s.streak && s.streak > 1 ? `  🔥 ${s.streak}d` : "";
  return `• ${s.ticker}  ${pct(s.totalWeightDelta)}  · ${funds}, ${provs}${streak}`;
}

export interface Broadcast {
  /** Full rundown, for the creator's preview. */
  briefText: string;
  /** Push notification title. */
  pushTitle: string;
  /** Auto-generated one-line push summary, used when the creator adds no note. */
  pushSummary: string;
  /** True when there's nothing to report — caller should block the send. */
  isEmpty: boolean;
  /** Top 5 buy signals, for the composer to render as real deep links. */
  topBuys: ApiSignal[];
  /** Top 5 sell signals, for the composer to render as real deep links. */
  topSells: ApiSignal[];
  /**
   * The single ticker the push notification itself deep-links to (a push
   * notification carries one tap target, not one per signal — see
   * broadcast-action.ts). The top buy if there is one, else the top sell,
   * else null when there's nothing to point at.
   */
  topSignal: ApiSignal | null;
}

export function buildBroadcast(payload: ApiFullPayload): Broadcast {
  const buys = payload.signals.buying.slice(0, 5);
  const sells = payload.signals.selling.slice(0, 5);
  const streaks = payload.briefing.activeStreaks.slice(0, 5);

  const lines: string[] = [
    `📊 TickerTrace — Institutional Brief`,
    payload.asOfDate,
    "",
  ];

  if (buys.length) {
    lines.push("🟢 Top buying conviction", ...buys.map(signalLine), "");
  }
  if (sells.length) {
    lines.push("🔴 Top selling conviction", ...sells.map(signalLine), "");
  }
  if (streaks.length) {
    lines.push(
      "🔥 On a streak",
      ...streaks.map(
        (s) =>
          `• ${s.ticker}  ${s.days}d ${s.direction === "up" ? "accumulation" : "distribution"} (${s.fund})`,
      ),
      "",
    );
  }

  lines.push("Tap to open the full cross-fund breakdown in TickerTrace.");

  const topBuy = buys[0];
  const topSell = sells[0];
  const summaryParts: string[] = [];
  if (topBuy) summaryParts.push(`Top buy ${topBuy.ticker} ${pct(topBuy.totalWeightDelta)}`);
  if (topSell) summaryParts.push(`top sell ${topSell.ticker} ${pct(topSell.totalWeightDelta)}`);
  if (streaks.length) summaryParts.push(`${streaks.length} on a streak`);

  return {
    briefText: lines.join("\n").trim(),
    pushTitle: `📊 Institutional Brief — ${payload.asOfDate}`,
    pushSummary: summaryParts.length
      ? `${summaryParts.join(" · ")}.`
      : "Today's institutional holdings brief is ready.",
    isEmpty: buys.length === 0 && sells.length === 0 && streaks.length === 0,
    topBuys: buys,
    topSells: sells,
    topSignal: topBuy ?? topSell ?? null,
  };
}
