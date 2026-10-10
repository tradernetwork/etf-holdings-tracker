/**
 * Pure formatting helpers. Rules come from the app design spec ("data rules"):
 * active-weight deltas are percentage points, never percents of anything; names
 * are cleaned for display only; dollar figures prefer the API's own fields and
 * are otherwise labelled estimates.
 */

const MINUS = "−"; // typographic minus, so it lines up with "+" in tabular figures

/** -0.0104 -> "−0.01 pp"; +0.5959 -> "+0.60 pp". Tiny non-zero values show "<0.01". */
export function formatPp(value: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = opts.sign ?? true;
  const abs = Math.abs(value);
  const prefix = value < 0 ? MINUS : sign && value > 0 ? "+" : "";
  if (abs === 0) return "0.00 pp";
  const body = abs < 0.005 ? "<0.01" : abs.toFixed(2);
  return `${prefix}${body} pp`;
}

/** A plain weight percentage (share of a fund's book): 1.7794 -> "1.78%". */
export function formatWeight(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

/** Compact dollars: 1.2e9 -> "$1.20B", 3.4e8 -> "$340M", 12_300 -> "$12.3K". Keeps the sign. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export interface UsdValue {
  /** Whole US dollars, or null when it can't be known. */
  usd: number | null;
  /** True when we computed it ourselves (weight x AUM) instead of the API. */
  estimated: boolean;
}

/**
 * A dollar amount for a position or flow. Uses the API's explicit field
 * (aumUsd / positionUsd / activeFlowUsd) whenever it is present, otherwise
 * falls back to `weightPercent / 100 * aumBillions * 1e9` and marks it estimated.
 * `aum` is in BILLIONS in the API; the explicit fields are whole dollars.
 */
export function resolveUsd(input: {
  apiUsd?: number | null;
  weightPercent?: number | null;
  aumBillions?: number | null;
}): UsdValue {
  if (input.apiUsd != null) return { usd: input.apiUsd, estimated: false };
  if (input.weightPercent != null && input.aumBillions != null) {
    return { usd: (input.weightPercent / 100) * input.aumBillions * 1e9, estimated: true };
  }
  return { usd: null, estimated: false };
}

/** "$340M" or "est. $340M". */
export function formatUsdValue(v: UsdValue): string {
  if (v.usd == null) return "—";
  return v.estimated ? `est. ${formatUsd(v.usd)}` : formatUsd(v.usd);
}

/** Fund AUM in dollars: prefers `aumUsd`, else `aum` (billions). Never an estimate: AUM is reported. */
export function fundAumUsd(f: { aum?: number | null; aumUsd?: number | null }): number | null {
  if (f.aumUsd != null) return f.aumUsd;
  if (f.aum != null) return f.aum * 1e9;
  return null;
}

// ---- names -----------------------------------------------------------------

const CURRENCIES = "USD|EUR|GBP|KRW|TWD|JPY|CHF|CAD|SEK|HKD|PLN|DKK|NOK|AUD|CNY|BRL|MXN|INR|ZAR|ILS|SGD|NZD|TRY|THB|IDR|MYR";
const CORP_CASE: Record<string, string> = {
  INC: "Inc", CO: "Co", CORP: "Corp", LTD: "Ltd", PLC: "Plc", LLC: "LLC", LP: "LP",
  HOLDINGS: "Holdings", GROUP: "Group", CORPORATION: "Corporation", COMPANY: "Company",
};
const KEEP_UPPER = new Set(["REIT", "ETF", "NASDAQ", "USA", "AI"]);
const MINOR = new Set(["OF", "AND", "THE", "&", "DE", "DEL", "LA"]);

/**
 * Display name for a security. Strips share-class / par-value / currency noise
 * ("APPLE INC COMMON STOCK USD.00001" -> "Apple Inc") and title-cases
 * ALL-CAPS names. Mixed-case names are left alone. The raw name should stay
 * available in a details view; this is for headlines only.
 */
export function cleanName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/\s\+\s/g, " & ");
  s = s.replace(/\s+(COMMON STOCK|COMMON SHARES?|ORDINARY SHARES?|ORD SHS|ORD|SHS|CAPITAL STOCK|NPV)\b.*$/i, "");
  s = s.replace(/\s+(SPONSORED )?(ADR|GDR)\b.*$/i, "");
  s = s.replace(/\s+(CLASS|CL)\s+[A-Z0-9]\b/gi, "");
  s = s.replace(/\s*-\s*(?:class|cl)\s+[A-Z0-9]$/i, ""); // "Inc -class A", "Inc-cl A"
  s = s.replace(/\s+-\s*[A-C]?$/, ""); // dangling "Inc - A" / "Inc -"
  s = s.replace(new RegExp(`\\s+(${CURRENCIES})\\s*[\\d.,]*\\s*$`, "i"), "");
  s = s.replace(/\s+[\d.]+$/, "");
  s = s.replace(/\b(Inc|Corp|Ltd|Co|Plc|INC|CORP|LTD|CO|PLC)\s+[A-C]$/, "$1"); // trailing share-class letter
  s = s.trim();
  if (!s) return raw.trim();
  if (s !== s.toUpperCase()) return s; // already mixed case
  return s
    .split(" ")
    .map((w, i) => {
      if (CORP_CASE[w]) return CORP_CASE[w];
      if (i > 0 && MINOR.has(w)) return w === "&" ? w : w.toLowerCase();
      // Short all-caps tokens are usually acronyms (SAP, UBS, AG, NV).
      if ((w.length <= 3 || KEEP_UPPER.has(w)) && /^[A-Z]+$/.test(w)) return w;
      return w
        .split("/")
        .map((p) => (CORP_CASE[p] ? CORP_CASE[p] : p.charAt(0) + p.slice(1).toLowerCase()))
        .join("/");
    })
    .join(" ");
}

/** "INFORMATION TECHNOLOGY" / "Information Technology" -> "Information Technology". Empty stays empty. */
export function sectorLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (MINOR.has(w.toUpperCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const SECTOR_SHORT: Record<string, string> = {
  "Information Technology": "Info Tech",
  "Consumer Discretionary": "Cons. Discretionary",
  "Consumer Staples": "Cons. Staples",
  "Communication Services": "Comm. Services",
};
/** Short sector label for tight rows; unknown sectors pass through. */
export const sectorShort = (raw: string): string => SECTOR_SHORT[sectorLabel(raw)] ?? sectorLabel(raw);

// ---- dates and freshness -----------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-09" -> "Oct 9". Parsed by hand: no timezone or locale surprises. */
export function formatShortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

export interface Freshness {
  text: string;
  stale: boolean;
}

/**
 * How current a fund's disclosure is. A stale fund is an OLDER DISCLOSURE, never
 * "no trades": the provider simply hasn't published a newer file.
 */
export function freshnessLabel(input: {
  stale?: boolean | null;
  date?: string | null;
}): Freshness {
  const d = formatShortDate(input.date);
  if (input.stale) return { stale: true, text: d ? `Older disclosure · ${d}` : "Older disclosure" };
  return { stale: false, text: d ? `As of ${d}` : "" };
}

/** Signed share count with thousands separators: 209486 -> "+209,486", -7502 -> "−7,502". */
export function formatShares(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const body = Math.abs(Math.round(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0 ? MINUS : value > 0 ? "+" : ""}${body}`;
}
