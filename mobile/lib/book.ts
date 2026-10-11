/**
 * Brokerage-style view of a fund's book: stocks, option legs (grouped by
 * underlying), Treasuries, cash and swaps, with an allocation breakdown.
 * Pure functions only, so every rule is unit tested. Nothing here invents a
 * value: a missing number stays null and renders as "—".
 */
import { cleanName, formatUsd, resolveUsd, type UsdValue } from "./format";
import type { FundOptionHolding, FundResponse, HoldingRow } from "./types";

export type Sleeve = "stock" | "option" | "treasury" | "cash" | "swap";

// Mirrors api/income.py `_sleeve_of` so the app and the Income screen agree on what a row is.
const TREASURY_HINTS = ["TREASURY", "T-BILL", "TBILL", "BILL "];
const CASH_HINTS = ["CASH", "MONEY MARKET", "MMKT", "OBLIGATIONS", "GOVERNMENT & AGENCY", "NET OTHER", "OTHER ASSET", "PAYABLE", "RECEIVABLE"];
const SWAP_HINTS = ["SWAP", "WEEKLYPAY"];
const CASH_TICKERS = new Set(["WEEK", "B", "TBILL", "CASH"]);

export function sleeveOf(r: Pick<HoldingRow, "isOption" | "name" | "ticker">): Sleeve {
  if (r.isOption) return "option";
  const name = (r.name ?? "").toUpperCase();
  const ticker = (r.ticker ?? "").toUpperCase();
  if (SWAP_HINTS.some((h) => name.includes(h))) return "swap";
  // `ticker in CASH_TICKERS` is only trusted for non-company names: Pathward Financial's real ticker is CASH.
  const looksLikeCompany = /\b(INC|CORP|CO|LTD|PLC|COMMON STOCK)\b/.test(name);
  if (TREASURY_HINTS.some((h) => name.includes(h)) || (CASH_TICKERS.has(ticker) && !looksLikeCompany)) return "treasury";
  if (CASH_HINTS.some((h) => name.includes(h)) || (ticker.length === 5 && ticker.endsWith("XX"))) return "cash";
  return "stock";
}

// ---- option labels --------------------------------------------------------------

/** 135 -> "$135", 150.01 -> "$150.01", 152.5 -> "$152.50". FLEX decimals are kept. */
export function formatStrike(strike: number | null | undefined): string {
  if (strike == null || Number.isNaN(strike)) return "—";
  return Number.isInteger(strike) ? `$${strike}` : `$${strike.toFixed(2)}`;
}

/** "Call" / "Put" from the API's casing ("CALL", "Call", "C"). Unknown stays "". */
export function normalizeOptionType(t: string | null | undefined): "Call" | "Put" | "" {
  const s = (t ?? "").trim().toUpperCase();
  return s.startsWith("C") ? "Call" : s.startsWith("P") ? "Put" : "";
}

/** "MSTR $135 Call", as Robinhood/Webull title a leg. */
export function optionTitle(underlying: string | null | undefined, type: string | null | undefined, strike: number | null | undefined): string {
  return [underlying ?? "", formatStrike(strike), normalizeOptionType(type)].filter(Boolean).join(" ");
}

/** "2026-11-20" -> "11/20/26". */
export function formatExpiry(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : "—";
}

/** Whole days from isoA to isoB (UTC date arithmetic, no timezone drift). null if either is unparseable. */
export function daysBetween(isoA: string | null | undefined, isoB: string | null | undefined): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoA ?? "");
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoB ?? "");
  if (!a || !b) return null;
  const ms = Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3]);
  return Math.round(ms / 86_400_000);
}

/** Expired = the expiry date is before the snapshot date. A leg expiring ON the snapshot date is still shown. */
export const isExpired = (expiry: string | null | undefined, asOfDate: string): boolean => {
  const d = daysBetween(asOfDate, expiry);
  return d !== null && d < 0;
};

/** "42 DTE", "1 DTE", "Expires today". */
export function dteLabel(dte: number | null | undefined): string {
  if (dte == null || Number.isNaN(dte)) return "";
  return dte === 0 ? "Expires today" : `${dte} DTE`;
}

/** "11/20/26 · 42 DTE" (+ " · FLEX" for a FLEX contract). */
export function optionSubtitle(expiry: string | null | undefined, dte: number | null | undefined, isFlex: boolean | null | undefined): string {
  return [formatExpiry(expiry), dteLabel(dte), isFlex ? "FLEX" : ""].filter(Boolean).join(" · ");
}

/** "Long · 40,450 contracts" / "Short · 9,400 contracts". Negative contracts = written. */
export function sideLabel(contracts: number | null | undefined): string {
  if (contracts == null || Number.isNaN(contracts) || contracts === 0) return "";
  const n = Math.abs(Math.round(contracts)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${contracts < 0 ? "Short" : "Long"} · ${n} ${Math.abs(contracts) === 1 ? "contract" : "contracts"}`;
}

export interface MoneynessChip {
  label: "ITM" | "OTM" | "ATM";
  underlyingPrice: number;
}

/** In/out of the money from the underlying price and strike. null when either is unknown. */
export function moneynessChip(type: string | null | undefined, strike: number | null | undefined, underlyingPrice: number | null | undefined): MoneynessChip | null {
  const t = normalizeOptionType(type);
  if (!t || strike == null || underlyingPrice == null || !(underlyingPrice > 0)) return null;
  const diff = t === "Call" ? underlyingPrice - strike : strike - underlyingPrice;
  return { label: diff > 0 ? "ITM" : diff < 0 ? "OTM" : "ATM", underlyingPrice };
}

// ---- the book ---------------------------------------------------------------------

export interface StockLine {
  key: string;
  ticker: string;
  name: string;
  shares: number;
  value: UsdValue;
  weight: number;
  /** Shares added/removed vs the previous file. null on a catch-up fund. */
  sharesDelta: number | null;
  /** Active-weight change in pp (null when unknown or catch-up). */
  activeDelta: number | null;
}

export interface OptionLine {
  key: string;
  underlying: string;
  type: "Call" | "Put" | "";
  strike: number | null;
  expiry: string | null;
  dte: number | null;
  /** Signed contracts: negative = written (short). */
  contracts: number;
  short: boolean;
  flex: boolean;
  value: UsdValue;
  weight: number;
  contractsDelta: number | null;
  chip: MoneynessChip | null;
}

export interface OptionGroup {
  underlying: string;
  lines: OptionLine[];
  /** Subtotals (signed: written legs subtract). */
  valueUsd: number | null;
  weight: number;
  /** Last price of the underlying, when the fund payload has one (shown once per group). */
  underlyingPrice: number | null;
}

export interface BucketLine {
  key: string;
  name: string;
  value: UsdValue;
  weight: number;
}
export interface Bucket {
  sleeve: "treasury" | "cash" | "swap";
  label: string;
  lines: BucketLine[];
  valueUsd: number | null;
  weight: number;
}

export type AllocKey = "stocks" | "optionsLong" | "optionsShort" | "treasury" | "cash" | "swap";
export interface AllocSegment {
  key: AllocKey;
  label: string;
  /** Signed weight in % of the fund (written options are negative). */
  weight: number;
}

export interface Book {
  stocks: StockLine[];
  optionGroups: OptionGroup[];
  buckets: Bucket[];
  allocation: AllocSegment[];
  /** Expired option legs that were dropped. */
  expiredHidden: number;
}

export interface BookContext {
  asOfDate: string;
  fundAumBillions?: number | null;
  /** Active-weight pp by ticker for stocks, from the fund's recentChanges (null on catch-up). */
  activeDeltaByTicker?: Map<string, number | null>;
  /** Extras the /holdings rows lack (dte, underlying price), keyed by optionKey(). */
  optionExtras?: Map<string, FundOptionHolding>;
}

const num = (v: number | null | undefined): number => (v == null || Number.isNaN(v) ? 0 : v);

/** Stable identity of an option leg across payloads (the OCC-style tickers differ in spacing). */
export const optionKey = (underlying: string | null | undefined, type: string | null | undefined, strike: number | null | undefined, expiry: string | null | undefined): string =>
  `${(underlying ?? "").toUpperCase()}|${normalizeOptionType(type)}|${strike == null ? "" : Number(strike).toFixed(3)}|${(expiry ?? "").slice(0, 10)}`;

/** Reported market value; when the row has none, the API's own position estimate (labelled est.). */
function valueOf(r: HoldingRow): UsdValue {
  if (r.marketValue != null) return { usd: r.marketValue, estimated: false };
  return resolveUsd({ apiUsd: r.positionUsd ?? null });
}

export function buildBook(rows: HoldingRow[], ctx: BookContext): Book {
  const stocks: StockLine[] = [];
  const legsByUnderlying = new Map<string, OptionLine[]>();
  const bucketMap = new Map<Bucket["sleeve"], Bucket>();
  const alloc: Record<AllocKey, number> = { stocks: 0, optionsLong: 0, optionsShort: 0, treasury: 0, cash: 0, swap: 0 };
  let expiredHidden = 0;

  for (const r of rows) {
    const sleeve = sleeveOf(r);
    const w = num(r.weight);
    if (sleeve === "stock") {
      alloc.stocks += w;
      stocks.push({
        key: `s:${r.ticker}`,
        ticker: r.ticker,
        name: cleanName(r.name),
        shares: r.shares,
        value: valueOf(r),
        weight: w,
        sharesDelta: r.sharesDelta,
        activeDelta: ctx.activeDeltaByTicker?.get(r.ticker) ?? null,
      });
    } else if (sleeve === "option") {
      const contracts = num(r.contracts ?? r.shares);
      if (contracts < 0) alloc.optionsShort += w;
      else alloc.optionsLong += w;
      if (isExpired(r.expiry, ctx.asOfDate)) {
        expiredHidden++;
        continue; // expired legs are not positions anymore
      }
      const underlying = (r.underlying ?? "").toUpperCase() || "OTHER";
      const key = optionKey(underlying, r.optionType, r.strike, r.expiry);
      const extra = ctx.optionExtras?.get(key);
      const type = normalizeOptionType(r.optionType);
      const line: OptionLine = {
        key: `o:${r.ticker}`,
        underlying,
        type,
        strike: r.strike ?? null,
        expiry: r.expiry ?? null,
        dte: extra?.dte ?? daysBetween(ctx.asOfDate, r.expiry),
        contracts,
        short: contracts < 0,
        flex: !!r.isFlex,
        value: valueOf(r),
        weight: w,
        contractsDelta: r.sharesDelta,
        chip: moneynessChip(type, r.strike, extra?.underlyingPrice ?? null),
      };
      legsByUnderlying.set(underlying, [...(legsByUnderlying.get(underlying) ?? []), line]);
    } else {
      alloc[sleeve] += w;
      const b = bucketMap.get(sleeve) ?? { sleeve, label: BUCKET_LABELS[sleeve], lines: [], valueUsd: null, weight: 0 };
      b.lines.push({ key: `b:${r.ticker}:${b.lines.length}`, name: r.name, value: valueOf(r), weight: w });
      bucketMap.set(sleeve, b);
    }
  }

  const optionGroups: OptionGroup[] = [...legsByUnderlying.entries()].map(([underlying, lines]) => ({
    underlying,
    lines,
    valueUsd: sumKnown(lines.map((l) => l.value.usd)),
    weight: lines.reduce((a, l) => a + l.weight, 0),
    underlyingPrice: lines.find((l) => l.chip)?.chip?.underlyingPrice ?? null,
  }));
  const buckets: Bucket[] = (["treasury", "cash", "swap"] as const)
    .map((k) => bucketMap.get(k))
    .filter((b): b is Bucket => !!b)
    .map((b) => ({ ...b, valueUsd: sumKnown(b.lines.map((l) => l.value.usd)), weight: b.lines.reduce((a, l) => a + l.weight, 0) }));

  const segments: AllocSegment[] = [
    { key: "stocks", label: "Stocks", weight: alloc.stocks },
    { key: "optionsLong", label: "Options (long)", weight: alloc.optionsLong },
    { key: "optionsShort", label: "Options (written)", weight: alloc.optionsShort },
    { key: "treasury", label: "Treasuries", weight: alloc.treasury },
    { key: "cash", label: "Cash", weight: alloc.cash },
    { key: "swap", label: "Swaps", weight: alloc.swap },
  ];
  return { stocks, optionGroups, buckets, allocation: segments.filter((s) => Math.abs(s.weight) >= 0.005), expiredHidden };
}

const BUCKET_LABELS: Record<Bucket["sleeve"], string> = {
  treasury: "Treasury bills & notes",
  cash: "Cash & money market",
  swap: "Swaps",
};

/** Sum, or null when ANY value is unknown (never a deceptively complete total). */
function sumKnown(values: (number | null)[]): number | null {
  return values.every((v) => v != null) ? (values as number[]).reduce((a, b) => a + b, 0) : null;
}

// ---- sorting ---------------------------------------------------------------------

export type SortKey = "value" | "weight" | "change" | "expiry";

const absVal = (v: UsdValue): number => Math.abs(v.usd ?? 0);
const nullsLast = (a: number | null, b: number | null, dir: 1 | -1 = -1): number =>
  a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : dir * (a - b);

export function sortStocks(lines: StockLine[], key: SortKey): StockLine[] {
  const by: Record<SortKey, (a: StockLine, b: StockLine) => number> = {
    value: (a, b) => absVal(b.value) - absVal(a.value),
    weight: (a, b) => Math.abs(b.weight) - Math.abs(a.weight),
    change: (a, b) => nullsLast(a.activeDelta === null ? null : Math.abs(a.activeDelta), b.activeDelta === null ? null : Math.abs(b.activeDelta)),
    expiry: (a, b) => absVal(b.value) - absVal(a.value), // not meaningful for stocks: fall back to value
  };
  return [...lines].sort((a, b) => by[key](a, b) || absVal(b.value) - absVal(a.value));
}

/** Option legs inside a group; "expiry" is the natural chain order (expiry, then strike). */
export function sortLegs(lines: OptionLine[], key: SortKey): OptionLine[] {
  const chain = (a: OptionLine, b: OptionLine) =>
    (a.expiry ?? "").localeCompare(b.expiry ?? "") || (a.strike ?? 0) - (b.strike ?? 0) || a.type.localeCompare(b.type);
  const by: Record<SortKey, (a: OptionLine, b: OptionLine) => number> = {
    expiry: chain,
    value: (a, b) => absVal(b.value) - absVal(a.value),
    weight: (a, b) => Math.abs(b.weight) - Math.abs(a.weight),
    change: (a, b) => nullsLast(a.contractsDelta === null ? null : Math.abs(a.contractsDelta), b.contractsDelta === null ? null : Math.abs(b.contractsDelta)),
  };
  return [...lines].sort((a, b) => by[key](a, b) || chain(a, b));
}

/** Groups ordered by their subtotal (value / %), or by their soonest expiry. */
export function sortGroups(groups: OptionGroup[], key: SortKey): OptionGroup[] {
  const soonest = (g: OptionGroup) => g.lines.reduce((m, l) => (l.expiry && (m === "" || l.expiry < m) ? l.expiry : m), "");
  const by: Record<SortKey, (a: OptionGroup, b: OptionGroup) => number> = {
    value: (a, b) => Math.abs(b.valueUsd ?? 0) - Math.abs(a.valueUsd ?? 0),
    weight: (a, b) => Math.abs(b.weight) - Math.abs(a.weight),
    expiry: (a, b) => soonest(a).localeCompare(soonest(b)),
    change: (a, b) => by.value(a, b),
  };
  return [...groups].sort((a, b) => by[key](a, b) || a.underlying.localeCompare(b.underlying));
}

// ---- activity -------------------------------------------------------------------

/** One-line recent option activity: "Rolled MSTR calls: closed 5, opened 6". */
export function activityLines(f: Pick<FundResponse, "optionRolls" | "recentChanges">): string[] {
  const out: string[] = [];
  for (const r of f.optionRolls ?? []) {
    const kind = normalizeOptionType(r.optionType).toLowerCase() || "option";
    out.push(`Rolled ${r.underlying} ${kind}s: closed ${r.closed.length}, opened ${r.opened.length}`);
  }
  if (out.length === 0) {
    const opts = (f.recentChanges ?? []).filter((c) => c.isOption);
    const opened = opts.filter((c) => c.type === "NEW").length;
    const closed = opts.filter((c) => c.type === "REMOVED").length;
    if (opened || closed) out.push(`Option legs: opened ${opened}, closed ${closed}`);
  }
  return out;
}

// ---- fallback when the server can't give a full book ------------------------------

/** Rows rebuilt from /fund/{fund} (top-20 stocks + every option leg). Partial: no cash/Treasuries. */
export function rowsFromFundPayload(f: FundResponse): HoldingRow[] {
  const stocks: HoldingRow[] = (f.topHoldings ?? []).map((h) => ({
    fund: f.fund, ticker: h.ticker, name: h.name, weight: h.weight, positionUsd: h.positionUsd ?? null,
    shares: 0, weightDelta: h.weightDelta ?? null, sharesDelta: h.sharesDelta ?? null,
    isOption: false, marketValue: null,
  }));
  const options: HoldingRow[] = (f.optionHoldings ?? []).map((o) => ({
    fund: f.fund, ticker: o.ticker, name: o.name, weight: o.weight, positionUsd: o.positionUsd ?? null,
    shares: o.shares, weightDelta: null, sharesDelta: null, isOption: true, marketValue: o.marketValue ?? null,
    underlying: o.underlying, optionType: o.optionType, strike: o.strike, expiry: o.expiry, contracts: o.shares, isFlex: o.isFlex ?? null,
  }));
  return [...stocks, ...options];
}

export const optionExtrasOf = (f: Pick<FundResponse, "optionHoldings">): Map<string, FundOptionHolding> =>
  new Map((f.optionHoldings ?? []).map((o) => [optionKey(o.underlying, o.optionType, o.strike, o.expiry), o]));

/** "$93.5M · 8.30%" style helper for a row's right-hand column. */
export const valueText = (v: UsdValue): string => (v.usd == null ? "—" : v.estimated ? `est. ${formatUsd(v.usd)}` : formatUsd(v.usd));
