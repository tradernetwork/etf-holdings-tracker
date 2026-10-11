/**
 * "Option holders" on the ticker screen: which tracked funds hold options on this stock, leg by leg.
 * Pure: built from /api/v1/ticker/{t} (holdings[].optionDetails + the isOption rows of changes).
 * Mirrors the website's stock page ("Option positions on it"): signed contracts, expired legs hidden,
 * FLEX flagged, stale disclosure labelled.
 */
import { daysBetween, isExpired, moneynessChip, normalizeOptionType, type OptionLine } from "./book";
import { resolveUsd, type UsdValue } from "./format";
import type { TickerHolding } from "./types";

export interface OptionDetails {
  type?: string | null;
  strike?: number | null;
  expiry?: string | null;
  underlying?: string | null;
  contracts?: number | null;
  isFlex?: boolean | null;
}
/** A /ticker holdings row as the server sends it; the app's TickerHolding type predates these fields. */
export type TickerHoldingRow = TickerHolding & { shares?: number | null; optionDetails?: OptionDetails | null };
export interface TickerChangeRow {
  fund: string;
  isOption: boolean;
  sharesDelta?: number | null;
  optionDetails?: OptionDetails | null;
}

export interface OptionHolderFund {
  fund: string;
  provider: string;
  fileDate: string;
  stale: boolean;
  legs: OptionLine[];
  /** Signed sum of this stock's leg weights in the fund (written legs subtract). */
  netWeight: number;
  /** Signed est. dollars across the legs; null when no leg carries a value. */
  netValue: UsdValue;
  /** Shares of the stock the same fund holds (0 for a synthetic / option-only fund). */
  sharesHeld: number;
  /** Written-call contracts x100 as a share of the shares held; null when no shares or no written calls. */
  coveragePct: number | null;
  /** Legs left out because their expiry is before the fund's file date. */
  expiredHidden: number;
}
export interface OptionHolders {
  funds: OptionHolderFund[];
  legCount: number;
  expiredHidden: number;
  /** Price used for ITM/OTM: the API's own underlyingPrice when given, else implied from an equity holder; null when neither. */
  spot: number | null;
  spotSource: "api" | "implied" | null;
}

const legKey = (fund: string, type: string, strike: number | null | undefined, expiry: string | null | undefined) =>
  `${fund}|${normalizeOptionType(type)}|${strike ?? ""}|${expiry ?? ""}`;

/** Median of value/shares across fresh equity holders: a spot estimate, good enough for ITM/OTM. */
export function impliedSpot(holdings: TickerHoldingRow[]): number | null {
  const px = holdings
    .filter((h) => !h.isOption && !h.stale && h.positionUsd != null && h.shares != null && h.shares > 0)
    .map((h) => (h.positionUsd as number) / (h.shares as number))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (px.length === 0) return null;
  const mid = Math.floor(px.length / 2);
  return px.length % 2 ? px[mid] : (px[mid - 1] + px[mid]) / 2;
}

/** Median `underlyingPrice` the API reports on option rows of `symbol` (/fund/{f} optionHoldings). */
export function apiUnderlyingPrice(symbol: string, rows: { underlying?: string | null; underlyingPrice?: number | null }[]): number | null {
  const px = rows
    .filter((r) => (r.underlying ?? "").toUpperCase() === symbol.toUpperCase() && r.underlyingPrice != null && r.underlyingPrice > 0)
    .map((r) => r.underlyingPrice as number)
    .sort((a, b) => a - b);
  if (px.length === 0) return null;
  const mid = Math.floor(px.length / 2);
  return px.length % 2 ? px[mid] : (px[mid - 1] + px[mid]) / 2;
}

export function buildOptionHolders(symbol: string, holdings: TickerHoldingRow[], changes: TickerChangeRow[] = [], apiSpot: number | null = null): OptionHolders {
  const implied = impliedSpot(holdings);
  const spot = apiSpot ?? implied;
  const spotSource: OptionHolders["spotSource"] = apiSpot != null ? "api" : implied != null ? "implied" : null;
  const deltaByLeg = new Map<string, number | null>();
  for (const ch of changes) {
    const d = ch.optionDetails;
    if (ch.isOption && d) deltaByLeg.set(legKey(ch.fund, d.type ?? "", d.strike, d.expiry), ch.sharesDelta ?? null);
  }
  const sharesByFund = new Map<string, number>();
  for (const h of holdings) if (!h.isOption && h.shares != null) sharesByFund.set(h.fund, (sharesByFund.get(h.fund) ?? 0) + h.shares);

  const byFund = new Map<string, OptionHolderFund>();
  let expiredHidden = 0;
  holdings.forEach((h, i) => {
    if (!h.isOption || !h.optionDetails) return;
    const d = h.optionDetails;
    let f = byFund.get(h.fund);
    if (!f) {
      f = {
        fund: h.fund, provider: h.provider, fileDate: h.fileDate, stale: h.stale, legs: [], netWeight: 0,
        netValue: { usd: null, estimated: false }, sharesHeld: sharesByFund.get(h.fund) ?? 0, coveragePct: null, expiredHidden: 0,
      };
      byFund.set(h.fund, f);
    }
    if (isExpired(d.expiry, h.fileDate)) {
      f.expiredHidden++;
      expiredHidden++;
      return;
    }
    const contracts = d.contracts ?? h.shares ?? 0;
    const type = normalizeOptionType(d.type);
    const value = resolveUsd({ apiUsd: h.positionUsd ?? null });
    f.legs.push({
      key: `${legKey(h.fund, type, d.strike, d.expiry)}|${i}`,
      underlying: (d.underlying ?? symbol).toUpperCase(),
      type,
      strike: d.strike ?? null,
      expiry: d.expiry ?? null,
      dte: daysBetween(h.fileDate, d.expiry),
      contracts,
      short: contracts < 0,
      flex: !!d.isFlex,
      value,
      weight: h.weight,
      contractsDelta: deltaByLeg.get(legKey(h.fund, type, d.strike, d.expiry)) ?? null,
      chip: moneynessChip(type, d.strike, spot),
      asOf: h.fileDate,
    });
    f.netWeight += h.weight;
    if (value.usd != null) f.netValue = { usd: (f.netValue.usd ?? 0) + value.usd, estimated: true };
  });

  const funds = [...byFund.values()].filter((f) => f.legs.length > 0 || f.expiredHidden > 0);
  for (const f of funds) {
    // Soonest expiry first, then strike: how a broker lists a chain.
    f.legs.sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || (a.strike ?? 0) - (b.strike ?? 0));
    const writtenCalls = f.legs.filter((l) => l.short && l.type === "Call").reduce((s, l) => s + Math.abs(l.contracts), 0);
    f.coveragePct = f.sharesHeld > 0 && writtenCalls > 0 ? (writtenCalls * 100 / f.sharesHeld) * 100 : null;
  }
  // Largest option footprint first (gross weight), like the website's weight sort.
  const gross = (f: OptionHolderFund) => f.legs.reduce((s, l) => s + Math.abs(l.weight), 0);
  funds.sort((a, b) => gross(b) - gross(a));
  return { funds: funds.filter((f) => f.legs.length > 0), legCount: funds.reduce((s, f) => s + f.legs.length, 0), expiredHidden, spot, spotSource };
}

/** Adapts an /options/{t} structure leg to the shared option row. These legs carry no fund weight. */
export function legToLine(leg: { optionType: string; strike: number | null; expiry: string | null; contracts: number; isFlex: boolean | null; dte: number | null; marketValue: number | null; change: number | null; occ?: string }, underlying: string, index = 0, asOf: string | null = null): OptionLine {
  return {
    key: `${leg.occ ?? underlying}|${index}`,
    underlying,
    type: normalizeOptionType(leg.optionType),
    strike: leg.strike,
    expiry: leg.expiry,
    dte: leg.dte,
    contracts: leg.contracts,
    short: leg.contracts < 0,
    flex: !!leg.isFlex,
    value: leg.marketValue == null ? { usd: null, estimated: false } : { usd: leg.marketValue, estimated: false },
    weight: 0,
    contractsDelta: leg.change,
    chip: null,
    asOf,
  };
}
