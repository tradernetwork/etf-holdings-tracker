/**
 * The standalone holdings browser (website: /holdings and /holdings/export), on GET /api/v1/holdings.
 * Pure rules + fetchers: row typing, filters, the website's 12 sort columns, paging, CSV link, catch-up notes.
 *
 * Sorting: the API can sort only value, weight, delta and expiry. A narrowed book (one fund, a search, or an
 * option-only type) is small enough to load whole, so every one of the 12 columns sorts across ALL its rows
 * on the phone. The unfiltered book (~20k rows) is paged and sorted by the server, so only the four
 * server-sortable columns are offered there and the rest say how to enable them. Nothing sorts "just this page".
 */
import { ApiError, NetworkError } from "./api";
import { sleeveOf } from "./book";
import { fetchWithRetry } from "./retry";
import type { HoldingRow } from "./types";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

export type HoldingsKind = "all" | "stock" | "option" | "call" | "put";
export const KIND_OPTIONS: { value: HoldingsKind; label: string }[] = [
  { value: "all", label: "All rows" },
  { value: "stock", label: "Stocks" },
  { value: "option", label: "Options" },
  { value: "call", label: "Calls" },
  { value: "put", label: "Puts" },
];

export const PAGE_SIZES = [10, 20, 30, 40, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** The website's twelve columns, in its order. `server` is the API sort key when the server can do it. */
export type SortKey = "fund" | "ticker" | "name" | "type" | "shares" | "sharesDelta" | "weight" | "weightDelta" | "value" | "strike" | "expiry" | "dte";
export interface SortColumn { key: SortKey; label: string; server: "value" | "weight" | "delta" | "expiry" | null }
export const SORT_COLUMNS: SortColumn[] = [
  { key: "fund", label: "Fund", server: null },
  { key: "ticker", label: "Ticker", server: null },
  { key: "name", label: "Name", server: null },
  { key: "type", label: "Type", server: null },
  { key: "shares", label: "Shares", server: null },
  { key: "sharesDelta", label: "Δ Shares", server: null },
  { key: "weight", label: "Weight", server: "weight" },
  { key: "weightDelta", label: "Δ Weight", server: "delta" },
  { key: "value", label: "Mkt Val", server: "value" },
  { key: "strike", label: "Strike", server: null },
  { key: "expiry", label: "Expiry", server: "expiry" },
  { key: "dte", label: "DTE", server: null },
];

export interface HoldingsFilters {
  q: string;
  fund: string; // "" = all funds
  kind: HoldingsKind;
  sort: SortKey | null;
  dir: "asc" | "desc";
  page: number;
  size: number;
}
export const DEFAULT_FILTERS: HoldingsFilters = { q: "", fund: "", kind: "all", sort: null, dir: "desc", page: 1, size: DEFAULT_PAGE_SIZE };

// ---- row typing (the website's STOCK / CALL / PUT badge, plus what the raw book also holds) ------------------

export type RowType = "STOCK" | "CALL" | "PUT" | "CASH" | "T-BILL" | "SWAP" | "OTHER";
export function rowType(r: Pick<HoldingRow, "isOption" | "name" | "ticker" | "optionType"> & { assetClass?: string }): RowType {
  if (r.isOption) return (r.optionType ?? "").toUpperCase().startsWith("P") ? "PUT" : (r.optionType ?? "").toUpperCase().startsWith("C") ? "CALL" : "OTHER";
  const s = sleeveOf(r);
  if (s === "stock") return "STOCK";
  if (s === "cash") return "CASH";
  if (s === "treasury") return "T-BILL";
  if (s === "swap") return "SWAP";
  return "OTHER";
}

// ---- what the server is asked ----------------------------------------------------------------------------

/** Option-only kinds are small (hundreds of rows): load them whole and do everything locally. */
export const isOptionKind = (k: HoldingsKind): boolean => k === "option" || k === "call" || k === "put";

/** True when the filtered book is small enough to load whole, so every column can sort across all rows. */
export const loadsWhole = (f: Pick<HoldingsFilters, "fund" | "q" | "kind">): boolean => !!f.fund || f.q.trim().length > 0 || isOptionKind(f.kind);

/** Server filter params for a kind; calls/puts have no server filter, so they ask for all options and narrow locally. */
export const serverAsset = (k: HoldingsKind): "equity" | "option" | undefined => (k === "stock" ? "equity" : isOptionKind(k) ? "option" : undefined);

export function sortAllowed(col: SortColumn, f: Pick<HoldingsFilters, "fund" | "q" | "kind">): boolean {
  return loadsWhole(f) || col.server !== null;
}
export const sortDisabledNote = "Pick a fund, search, or choose Options/Calls/Puts to sort every row by this column.";

export function buildQuery(f: HoldingsFilters, opts: { paged: boolean; format?: "csv" }): string {
  const p = new URLSearchParams();
  if (f.fund) p.set("fund", f.fund);
  const asset = serverAsset(f.kind);
  if (asset) p.set("asset", asset);
  if (f.q.trim()) p.set("q", f.q.trim().slice(0, 64));
  if (opts.paged && !loadsWhole(f)) {
    p.set("page", String(f.page));
    p.set("size", String(f.size));
    const col = SORT_COLUMNS.find((c) => c.key === f.sort);
    if (col?.server) {
      p.set("sort", col.server);
      p.set("dir", f.dir);
    }
  }
  if (opts.format) p.set("format", opts.format);
  return p.toString();
}

/** The uncapped, filtered CSV: the API streams the whole result and ignores paging. Calls/Puts export every option row (no server type filter). */
export function csvUrl(f: HoldingsFilters): string {
  const { page: _p, size: _s, ...rest } = f;
  const qs = buildQuery({ ...rest, page: 1, size: DEFAULT_PAGE_SIZE }, { paged: false, format: "csv" });
  // A requested sort still orders the export, whichever column the server can do.
  const col = SORT_COLUMNS.find((c) => c.key === f.sort);
  const withSort = col?.server ? `${qs}&sort=${col.server}&dir=${f.dir}` : qs;
  return `${API_BASE}/api/v1/holdings?${withSort}`;
}
export const csvScopeNote = (f: Pick<HoldingsFilters, "kind">): string | null =>
  f.kind === "call" || f.kind === "put" ? "The CSV holds every option row: the server has no call/put filter." : null;

export interface HoldingsPage {
  asOfDate: string;
  /** The earlier snapshot the deltas are measured against, and how many trading days that spans (API, 2026-10-13). */
  previousDate?: string | null;
  comparisonTradingDays?: number | null;
  total: number;
  count: number;
  page?: number;
  pages?: number;
  size?: number;
  holdings: HoldingRow[];
}

export async function fetchHoldings(f: HoldingsFilters, signal?: AbortSignal): Promise<HoldingsPage> {
  const qs = buildQuery(f, { paged: true });
  let res: Response;
  try {
    res = await fetchWithRetry(fetch, `${API_BASE}/api/v1/holdings${qs ? `?${qs}` : ""}`, { signal, headers: { Accept: "application/json", "X-TickerTrace-Client": "app" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new NetworkError(e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as HoldingsPage;
}

// ---- local filter / sort / page for whole-loaded books ----------------------------------------------------

export function narrowKind(rows: HoldingRow[], kind: HoldingsKind): HoldingRow[] {
  if (kind === "call") return rows.filter((r) => rowType(r) === "CALL");
  if (kind === "put") return rows.filter((r) => rowType(r) === "PUT");
  return rows;
}

/** Cell value for a column; null = blank (always sorts last, like the website). */
export function sortValue(r: HoldingRow, key: SortKey): string | number | null {
  switch (key) {
    case "fund": return r.fund;
    case "ticker": return r.ticker;
    case "name": return r.name;
    case "type": return rowType(r);
    case "shares": return r.contracts ?? r.shares ?? null;
    case "sharesDelta": return r.catchUpSince !== undefined && r.catchUpSince !== null ? null : r.sharesDelta;
    case "weight": return r.weight ?? null;
    case "weightDelta": return r.catchUpSince !== undefined && r.catchUpSince !== null ? null : r.activeWeightDelta ?? null;
    case "value": return r.marketValue ?? r.positionUsd ?? null;
    case "strike": return r.strike ?? null;
    case "expiry": return r.expiry ?? null;
    case "dte": return r.dte ?? null;
  }
}

export function sortRows(rows: HoldingRow[], key: SortKey | null, dir: "asc" | "desc"): HoldingRow[] {
  if (!key) return rows;
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key), y = sortValue(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return typeof x === "string" || typeof y === "string" ? m * String(x).localeCompare(String(y)) : m * (Number(x) - Number(y));
  });
}

export function paginate<T>(rows: T[], page: number, size: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const pg = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((pg - 1) * size, pg * size), page: pg, pages };
}

/** Funds whose latest diff would be a multi-day catch-up, grouped by since-date: "AAA, BBB: catch-up since Sep 25". */
export function catchUpGroups(funds: { fund: string; catchUp?: boolean; catchUpSince?: string | null }[]): { since: string | null; funds: string[] }[] {
  const m = new Map<string, string[]>();
  for (const f of funds) if (f.catchUp) m.set(f.catchUpSince ?? "", [...(m.get(f.catchUpSince ?? "") ?? []), f.fund]);
  return [...m.entries()].map(([since, fs]) => ({ since: since || null, funds: fs.sort() }));
}

export function summaryLine(total: number, asOf: string | null | undefined, whole: boolean): string {
  const n = total.toLocaleString("en-US");
  return `${n} ${total === 1 ? "row" : "rows"}${asOf ? ` · ${asOf} file` : ""}${whole ? " · all sortable" : ""}`;
}
