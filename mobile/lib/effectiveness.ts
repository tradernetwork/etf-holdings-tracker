/**
 * Strategy effectiveness (website: components/fund-effectiveness.tsx) as pure view-models. Every field the
 * API returns for a metric is surfaced as a labelled row, so nothing the website shows is dropped.
 */
import { formatUsd } from "./format";
import type { Effectiveness } from "./fundExtras";

export type Tone = "good" | "ok" | "warn" | "bad" | "none";

/** >=80 good, >=60 ok, >=40 warn, else bad. null = no data. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "none";
  return score >= 80 ? "good" : score >= 60 ? "ok" : score >= 40 ? "warn" : "bad";
}

export function gradeTone(grade: string | null | undefined): Tone {
  switch (grade) {
    case "A": return "good";
    case "B": return "ok";
    case "C": return "warn";
    case "D":
    case "F": return "bad";
    default: return "none";
  }
}

const n1 = (v: number | null | undefined, unit = ""): string => (v == null ? "—" : `${Number(v.toFixed(1)).toLocaleString("en-US")}${unit}`);
const n2 = (v: number | null | undefined): string => (v == null ? "—" : v.toFixed(2));
const pct = (v: number | null | undefined): string => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const int = (v: number | null | undefined): string => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const usd = (v: number | null | undefined): string => formatUsd(v);

export interface MetricCard {
  key: string;
  title: string;
  score: number | null;
  /** What the website's tooltip explains, in one line. */
  blurb: string;
  rows: [string, string][];
  bars?: { label: string; value: number }[];
  lists?: { title: string; lines: string[] }[];
}

export function metricCards(e: Effectiveness): MetricCard[] {
  const s = e.strikeSelection, d = e.dteManagement, sp = e.spreadEfficiency, r = e.rollBehavior, p = e.premiumCapture, h = e.hedgeRatio, c = e.concentrationRisk;
  return [
    {
      key: "strikeSelection", title: "Strike selection", score: s.score, blurb: "How far from the money the written strikes sit.",
      rows: [
        ["Average moneyness", pct(s.avgMoneyness)], ["Calls", pct(s.callAvgMoneyness)], ["Puts", pct(s.putAvgMoneyness)],
        ["Written legs", int(s.writtenCount)], ["Call legs", int(s.callCount)], ["Put legs", int(s.putCount)],
        ...(s.dataCoverage != null ? ([["Data coverage", pct(s.dataCoverage)]] as [string, string][]) : []),
      ],
      bars: [
        { label: "Deep OTM", value: s.distribution.deepOTM }, { label: "Slightly OTM", value: s.distribution.slightlyOTM },
        { label: "ATM", value: s.distribution.atm }, { label: "ITM", value: s.distribution.itm },
      ],
    },
    {
      key: "dteManagement", title: "DTE management", score: d.score, blurb: "How the book is spread across expiries.",
      rows: [["Average DTE", n1(d.avgDTE)], ["Consistency", n1(d.consistency, "%")], ["Gamma-risk flag", d.gammaRiskFlag ? "Yes" : "No"]],
      bars: [
        { label: "Weekly", value: d.distribution.weekly }, { label: "Biweekly", value: d.distribution.biweekly },
        { label: "Monthly", value: d.distribution.monthly }, { label: "Long-dated", value: d.distribution.longDated },
      ],
    },
    {
      key: "spreadEfficiency", title: "Spread efficiency", score: sp.score, blurb: "How much of the written book sits inside defined-risk structures.",
      rows: [
        ["Spreads", int(sp.spreadCount)], ["Naked", int(sp.nakedCount)], ["Covered", int(sp.coveredCount)],
        ...(sp.syntheticCount != null ? ([["Synthetic", int(sp.syntheticCount)]] as [string, string][]) : []),
        ["Spread ratio", pct(sp.spreadRatio)], ["Avg risk / reward", n2(sp.avgRiskReward)], ["Avg width", n1(sp.avgWidthPct, "%")],
      ],
      lists: sp.spreads.length ? [{ title: "Spreads", lines: sp.spreads.map((x) => `${x.underlying} ${x.type} ${x.shortStrike}/${x.longStrike} · width ${x.width} (${n1(x.widthPct, "%")}) · risk/reward ${n2(x.riskReward)}`) }] : undefined,
    },
    {
      key: "rollBehavior", title: "Roll behaviour", score: r.score, blurb: "How the fund rolls expiring positions.",
      rows: [
        ["Rolls detected", int(r.rollsDetected)], ["Average roll DTE", n1(r.avgRollDTE)],
        ["Rolled up", int(r.strikeAdjustments.rolledUp)], ["Rolled down", int(r.strikeAdjustments.rolledDown)], ["Same strike", int(r.strikeAdjustments.same)],
        ["Weekend-gap rolls", int(r.weekendGapRolls)],
      ],
      lists: r.recentRolls.length
        ? [{ title: "Recent rolls", lines: r.recentRolls.map((x) => `${x.underlying} ${x.type} ${x.oldStrike} (${x.fromExpiry}) → ${x.newStrike} (${x.toExpiry})${x.rollDTE != null ? ` · ${x.rollDTE} DTE` : ""}${x.weekendGap ? " · weekend gap" : ""}`) }]
        : undefined,
    },
    {
      key: "premiumCapture", title: "Premium capture", score: p.score, blurb: "Option premium written versus bought, against NAV.",
      rows: [
        ["Premium written", usd(p.totalPremiumWritten)], ["Premium bought", usd(p.totalPremiumBought)], ["Net premium", usd(p.netPremium)],
        ["Premium as % of NAV", n2(p.premiumAsPercentNAV) + (p.premiumAsPercentNAV == null ? "" : "%")], ["Hedge cost ratio", n2(p.hedgeCostRatio)],
        ["Premium density", usd(p.premiumDensity)], ["Positions written", int(p.positionsWritten)], ["Positions bought", int(p.positionsBought)],
      ],
    },
    {
      key: "hedgeRatio", title: "Hedge ratio", score: h.score, blurb: "How much of the delta is covered or collared.",
      rows: [
        ["Net portfolio delta", n1(h.netPortfolioDelta)], ["Coverage ratio", pct(h.coverageRatio)], ["Collars", int(h.collarCount)],
        ["Covered calls", int(h.coveredCallCount)], ["Average |delta|", n1(h.avgAbsDelta)],
      ],
    },
    {
      key: "concentrationRisk", title: "Concentration risk", score: c.score, blurb: "How concentrated the book is by underlying and expiry.",
      rows: [
        ["HHI", n2(c.hhi)], ["Unique underlyings", int(c.uniqueUnderlyings)], ["Top expiry concentration", n1(c.topExpiryConcentration, "%")], ["Expiries", int(c.expiryCount)],
      ],
    },
  ];
}

/** The header facts the website shows above the metric cards. */
export function effectivenessFacts(e: Effectiveness): [string, string][] {
  return [
    ["Composite score", e.compositeScore == null ? "—" : e.compositeScore.toFixed(1)],
    ["Peer group", e.peerGroup],
    ["Write cadence", e.writeCadenceDays == null ? "—" : `${e.writeCadenceDays} days`],
    ["Synthetic pairs", int(e.syntheticPairs)],
    ["Hedging mandated", e.hedgingMandated ? "Yes" : "No"],
    ["History", `${int(e.historyDepth)} snapshots`],
    ["Options", int(e.optionsCount)],
    ["Net assets", usd(e.netAssets)],
    ["As of", e.asOfDate + (e.dataStale ? ` (stale${e.staleSnapshots ? `, ${e.staleSnapshots} snapshots` : ""})` : "")],
  ];
}

/** Score weights as "Strike selection 17.8%" lines (weights sum to ~100%). */
export function weightLines(e: Effectiveness): string[] {
  const label: Record<string, string> = {
    strikeSelection: "Strike selection", dteManagement: "DTE management", spreadEfficiency: "Spread efficiency", rollBehavior: "Roll behaviour",
    premiumCapture: "Premium capture", hedgeRatio: "Hedge ratio", concentrationRisk: "Concentration risk",
  };
  return Object.entries(e.weights).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${label[k] ?? k} ${(w * 100).toFixed(1)}%`);
}

const PEER_METRICS: { key: keyof Pick<Effectiveness, "strikeSelection" | "dteManagement" | "spreadEfficiency" | "rollBehavior" | "premiumCapture" | "hedgeRatio" | "concentrationRisk">; label: string }[] = [
  { key: "strikeSelection", label: "Strike" }, { key: "dteManagement", label: "DTE" }, { key: "spreadEfficiency", label: "Spread" },
  { key: "rollBehavior", label: "Roll" }, { key: "premiumCapture", label: "Premium" }, { key: "hedgeRatio", label: "Hedge" }, { key: "concentrationRisk", label: "Concentr." },
];

export interface PeerComparison {
  rank: number;
  total: number;
  /** Funds by composite score, best first. */
  ranking: { fund: string; grade: string; score: number | null; isCurrent: boolean }[];
  metrics: { label: string; score: number | null; best: number | null; rank: number }[];
}

/** Rank among all scored funds (the website ranks across every fund, as the endpoint returns them). */
export function peerComparison(peers: Effectiveness[], fund: string): PeerComparison | null {
  if (peers.length < 2) return null;
  const sorted = [...peers].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
  const idx = sorted.findIndex((f) => f.fund === fund);
  if (idx < 0) return null;
  const score = (f: Effectiveness, k: (typeof PEER_METRICS)[number]["key"]): number | null => f[k].score;
  return {
    rank: idx + 1,
    total: sorted.length,
    ranking: sorted.map((f) => ({ fund: f.fund, grade: f.grade, score: f.compositeScore, isCurrent: f.fund === fund })),
    metrics: PEER_METRICS.map(({ key, label }) => {
      const mine = score(sorted[idx], key);
      const all = sorted.map((f) => score(f, key)).filter((v): v is number => v != null).sort((a, b) => b - a);
      return { label, score: mine, best: all[0] ?? null, rank: mine == null ? 0 : all.indexOf(mine) + 1 };
    }),
  };
}

