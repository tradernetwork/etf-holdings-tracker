/**
 * The website's /effectiveness leaderboard as pure view-models: the metric selector that drives
 * ranking, the per-fund score row, and the methodology + limitations text (verbatim).
 */
import type { Effectiveness } from "./fundExtras";

export type BoardMetric = "composite" | "strike" | "dte" | "spread" | "roll" | "premium" | "hedge" | "concentration";

export const BOARD_METRICS: { key: BoardMetric; label: string; short: string }[] = [
  { key: "composite", label: "Grade", short: "Grade" },
  { key: "strike", label: "Strike selection", short: "Strike" },
  { key: "dte", label: "DTE management", short: "DTE" },
  { key: "spread", label: "Spread efficiency", short: "Spread" },
  { key: "roll", label: "Roll behaviour", short: "Roll" },
  { key: "premium", label: "Premium capture", short: "Premium" },
  { key: "hedge", label: "Hedge ratio", short: "Hedge" },
  { key: "concentration", label: "Concentration risk", short: "Conc." },
];

/** A fund's score for a metric; null = no data (the site sorts those last as -1). */
export function metricScore(f: Effectiveness, m: BoardMetric): number | null {
  switch (m) {
    case "composite": return f.compositeScore;
    case "strike": return f.strikeSelection?.score ?? null;
    case "dte": return f.dteManagement?.score ?? null;
    case "spread": return f.spreadEfficiency?.score ?? null;
    case "roll": return f.rollBehavior?.score ?? null;
    case "premium": return f.premiumCapture?.score ?? null;
    case "hedge": return f.hedgeRatio?.score ?? null;
    case "concentration": return f.concentrationRisk?.score ?? null;
  }
}

/** Best first by the chosen metric; funds with no score for it sink to the bottom (stable otherwise). */
export function rankFunds(funds: Effectiveness[], m: BoardMetric): Effectiveness[] {
  return funds
    .map((f, i) => ({ f, i, s: metricScore(f, m) ?? -1 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.f);
}

export interface BoardSummary {
  total: number;
  /** Funds with a composite grade (not "N/A"). */
  graded: number;
  byGrade: Record<string, number>;
  /** Mean composite over funds that have one. */
  averageComposite: number | null;
  hedgingMandated: number;
  peerGroups: string[];
  asOfDate: string | null;
  staleFunds: number;
}

/** Headline numbers for the top of the board. */
export function boardSummary(funds: Effectiveness[]): BoardSummary {
  const byGrade: Record<string, number> = {};
  for (const f of funds) byGrade[f.grade] = (byGrade[f.grade] ?? 0) + 1;
  const comps = funds.map((f) => f.compositeScore).filter((v): v is number => v != null);
  return {
    total: funds.length,
    graded: funds.filter((f) => f.grade && f.grade !== "N/A").length,
    byGrade,
    averageComposite: comps.length ? comps.reduce((a, b) => a + b, 0) / comps.length : null,
    hedgingMandated: funds.filter((f) => f.hedgingMandated).length,
    peerGroups: [...new Set(funds.map((f) => f.peerGroup))].sort(),
    asOfDate: funds.map((f) => f.asOfDate).sort().at(-1) ?? null,
    staleFunds: funds.filter((f) => f.dataStale).length,
  };
}

/** The strategy blurb's first sentence, as the website's table shows it. */
export const firstSentence = (s: string | null | undefined): string => {
  const t = (s ?? "").trim();
  if (!t) return "";
  const head = t.split(".")[0];
  return `${head}.`;
};

export interface MethodologyItem { title: string; text: string }

export const METHODOLOGY: MethodologyItem[] = [
  { title: "Strike Selection", text: "Evaluates WHERE options are sold relative to the underlying price. Calls and puts are scored separately — optimal zones differ (3-8% OTM for calls, 2-5% OTM for puts). Each fund is scored against its own prospectus-calibrated optimal moneyness band, so ATM-focused funds aren't penalized for selling near-the-money. Weighted by notional exposure (larger positions count more)." },
  { title: "DTE Management", text: "Scores WHEN options expire. Theta (time decay) accelerates non-linearly below 21 DTE. The sweet spot depends on the fund's write cycle — weekly writers sit around 3 DTE, two-week cycles around 6, monthly writers 14-21. The cycle label next to each fund (weekly / biweekly / monthly) is measured from its actual expiries, not a prospectus guess. Synthetic-stock legs (long call + short put used to hold the underlying) and expired contracts are excluded. Includes a consistency bonus for systematic execution (tight DTE clustering) and gamma risk penalties for very short DTE when it's off-strategy." },
  { title: "Spread Efficiency", text: "Evaluates HOW risk is managed. Detects defined-risk spreads (same underlying, same expiry, opposite positions, different strikes). Recognizes equity-covered calls as implicitly hedged. Scores on risk/reward ratio (premium ÷ max loss) — a $5-wide spread collecting $3 scores much higher than one collecting $0.50." },
  { title: "Roll Behavior", text: "Tracks position MANAGEMENT over time by comparing daily snapshots. Detects rolls (same underlying + type, changed expiry). Scores roll timing (ideal: 3-7 DTE remaining) and tracks roll direction (up = bullish adjustment, down = defensive)." },
  { title: "Premium Capture", text: "Measures INCOME GENERATION efficiency. Reports net premium (written minus bought), premium as a percentage of NAV, and the hedge cost ratio (how much of gross premium is spent on protection). Higher NAV yield with moderate hedge cost scores best." },
  { title: "Hedge Ratio", text: "Scores COVERAGE using Black-Scholes approximate delta (σ=30%, r=5%). For each underlying with written options, checks for stock (held outright or via a synthetic long) or protective long options. Only stock the options are written on counts toward delta — cash and T-bills do not. Lower net directional delta and higher coverage = better hedged. Funds where hedging is NOT mandated by prospectus get reduced weight for this metric." },
  { title: "Concentration Risk", text: "Scores DIVERSIFICATION using a Herfindahl-Hirschman Index (HHI) across underlyings by notional value. Also flags expiry clustering where too many positions expire on a single date (correlated risk event). Lower HHI and more expiry diversification = better score." },
  { title: "Composite Grade", text: "The final grade is a DYNAMIC weighted average — weights shift based on data confidence (more positions → higher weight) and risk signals (low hedge score → hedge metric weight increases). Each fund also has prospectus-calibrated weights (e.g., EGGS has 25% hedge weight because hedging is mandated; SLTY has 8% because it IS the hedge). Not arbitrary fixed weights." },
];

export const LIMITATIONS: string[] = [
  "Analysis is based on daily holdings snapshots, not live trade data. Actual Greeks, bid-ask spreads, and real-time implied volatility are not available.",
  "Black-Scholes approximations use a fixed σ=30% and r=5%. Actual implied volatility varies by underlying, strike, and expiry.",
  "Scores improve with more historical data. Funds with fewer days of history may have less reliable roll behavior and trend signals.",
  "This is not investment advice. Scores reflect strategy execution quality, not expected returns or risk-adjusted performance.",
];

export const BOARD_SHARE_URL = "https://tickertrace.pro/effectiveness";
export const boardShareText = (n: number): string =>
  `How effective are your option-income ETFs? ${n} funds scored side-by-side on strike selection, DTE management, hedging, and more.\n\nFree institutional-grade analysis 👇`;
