import type { Change, CategoryChoice } from "../types";
import { resolveUsd } from "../format";
import type {
  ChangeFilters,
  ChangesResponse,
  FundMap,
  StockRow,
  StockFilters,
  TrendRow,
  Horizon,
  MatrixRow,
  HistoryPoint,
} from "./types";
export const emptyChangeFilters: ChangeFilters = {
  fund: "",
  provider: "",
  sector: "",
  type: "all",
  direction: "all",
  search: "",
};
export const emptyStockFilters: StockFilters = {
  provider: "",
  sector: "",
  signal: "all",
  search: "",
  sort: "funds",
};
export const trendLabels = {
  accumulating: "Accumulating",
  "distribution-starting": "Selling starting",
  distributing: "Distributing",
  bottoming: "Bottoming",
};
export function moveType(row: Change): string {
  if (row.activeWeightDelta == null) return "UNKNOWN";
  if (row.type === "NEW") return "NEW";
  if (row.type === "REMOVED") return "EXIT";
  return row.activeWeightDelta > 0
    ? "ADD"
    : row.activeWeightDelta < 0
      ? "TRIM"
      : "UNCHANGED";
}
export function filterChanges(
  rows: Change[],
  f: ChangeFilters,
  funds: FundMap,
): Change[] {
  const q = f.search.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        !r.isOption &&
        (!f.fund || r.fund === f.fund) &&
        (!f.provider || funds.get(r.fund)?.provider === f.provider) &&
        (!f.sector || r.sector === f.sector) &&
        (f.type === "all" || moveType(r) === f.type) &&
        (f.direction === "all" ||
          (r.activeWeightDelta != null &&
            (f.direction === "buying"
              ? r.activeWeightDelta > 0
              : r.activeWeightDelta < 0))) &&
        (!q || `${r.ticker} ${r.name} ${r.fund}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      const key = f.sort ?? "delta";
      const direction = (f.ascending ?? key !== "delta") ? 1 : -1;
      if (key === "delta") {
        if (a.activeWeightDelta == null && b.activeWeightDelta != null)
          return 1;
        if (b.activeWeightDelta == null && a.activeWeightDelta != null)
          return -1;
        return (
          direction *
            (Math.abs(a.activeWeightDelta ?? 0) -
              Math.abs(b.activeWeightDelta ?? 0)) ||
          a.ticker.localeCompare(b.ticker) ||
          a.fund.localeCompare(b.fund)
        );
      }
      const av = key === "type" ? moveType(a) : a[key],
        bv = key === "type" ? moveType(b) : b[key];
      return (
        direction * av.localeCompare(bv) ||
        a.ticker.localeCompare(b.ticker) ||
        a.fund.localeCompare(b.fund)
      );
    });
}
export function moveCounts(rows: Change[]): { added: number; reduced: number } {
  return {
    added: rows.filter(
      (r) =>
        !r.isOption && r.activeWeightDelta != null && r.activeWeightDelta > 0,
    ).length,
    reduced: rows.filter(
      (r) =>
        !r.isOption && r.activeWeightDelta != null && r.activeWeightDelta < 0,
    ).length,
  };
}
export function filterStocks(
  rows: StockRow[],
  f: StockFilters,
  funds: FundMap,
): StockRow[] {
  const q = f.search.trim().toLowerCase();
  const value = (r: StockRow) =>
    f.sort === "weight"
      ? r.totalWeight
      : f.sort === "change"
        ? Math.abs(r.netChange)
        : f.sort === "streak"
          ? Math.abs(r.streak ?? 0)
          : r.fundCount;
  return rows
    .filter(
      (r) =>
        (!q || `${r.ticker} ${r.name}`.toLowerCase().includes(q)) &&
        (!f.sector || r.sector === f.sector) &&
        (!f.provider ||
          r.funds.some((fund) => funds.get(fund)?.provider === f.provider)) &&
        (f.signal === "all" ||
          (f.signal === "buying" && r.netChange > 0) ||
          (f.signal === "selling" && r.netChange < 0) ||
          (f.signal === "streak" && Math.abs(r.streak ?? 0) >= 3) ||
          (f.signal === "new" && r.newEntryFunds?.length > 0) ||
          (f.signal === "exit" && (r.exitFunds?.length ?? 0) > 0) ||
          (f.signal === "crossfam" && (r.distinctProviders ?? 0) >= 2)),
    )
    .sort((a, b) => value(b) - value(a) || a.ticker.localeCompare(b.ticker));
}
export function trendGroups(
  rows: TrendRow[],
  horizon: Horizon,
): { signal: keyof typeof trendLabels; rows: TrendRow[] }[] {
  const key = horizon === "all" ? "monthly" : horizon;
  return (Object.keys(trendLabels) as (keyof typeof trendLabels)[]).map(
    (signal) => ({
      signal,
      rows: rows
        .filter((r) => r.signal === signal)
        .sort(
          (a, b) =>
            (b[key] == null ? -1 : Math.abs(b[key]!)) -
              (a[key] == null ? -1 : Math.abs(a[key]!)) ||
            a.ticker.localeCompare(b.ticker),
        ),
    }),
  );
}
export function matrixRows(rows: Change[]): MatrixRow[] {
  const map = new Map<string, MatrixRow>();
  for (const r of rows) {
    if (r.isOption || r.activeWeightDelta == null) continue;
    let item = map.get(r.ticker);
    if (!item) {
      item = { ticker: r.ticker, cells: new Map(), magnitude: 0 };
      map.set(r.ticker, item);
    }
    item.cells.set(r.fund, r);
  }
  for (const r of map.values())
    r.magnitude = [...r.cells.values()].reduce(
      (v, c) => v + Math.abs(c.activeWeightDelta!),
      0,
    );
  return [...map.values()].sort(
    (a, b) => b.magnitude - a.magnitude || a.ticker.localeCompare(b.ticker),
  );
}
/** Coordinates in a 100 × 36 box; actual dates/weights remain in the accessible labels. */
export function sparkline(points: HistoryPoint[]): { x: number; y: number }[] {
  if (!points.length) return [];
  const values = points.map((p) => p.blendedWeight),
    lo = Math.min(...values),
    hi = Math.max(...values);
  return points.map((p, i) => ({
    x: points.length === 1 ? 0 : (i / (points.length - 1)) * 100,
    y: hi === lo ? 18 : 36 - ((p.blendedWeight - lo) / (hi - lo)) * 36,
  }));
}

export function aggregateChanges(
  rows: Change[],
  funds: FundMap,
): {
  ticker: string;
  rows: Change[];
  buying: string[];
  selling: string[];
  netDelta: number | null;
  flowUsd: number | null;
  knownDollarRows: number;
}[] {
  const buckets = new Map<string, Change[]>();
  for (const row of rows) {
    if (row.isOption) continue;
    buckets.set(row.ticker, [...(buckets.get(row.ticker) ?? []), row]);
  }
  return [...buckets]
    .map(([ticker, group]) => {
      const known = group.filter((r) => r.activeWeightDelta != null);
      const dollars = known
        .map(
          (r) =>
            resolveUsd({
              apiUsd: r.activeFlowUsd,
              weightPercent: r.activeWeightDelta,
              aumBillions: funds.get(r.fund)?.aum,
            }).usd,
        )
        .filter((v): v is number => v != null);
      return {
        ticker,
        rows: group,
        buying: [
          ...new Set(
            known.filter((r) => r.activeWeightDelta! > 0).map((r) => r.fund),
          ),
        ],
        selling: [
          ...new Set(
            known.filter((r) => r.activeWeightDelta! < 0).map((r) => r.fund),
          ),
        ],
        netDelta: known.length
          ? known.reduce((v, r) => v + r.activeWeightDelta!, 0)
          : null,
        flowUsd: dollars.length ? dollars.reduce((a, b) => a + b, 0) : null,
        knownDollarRows: dollars.length,
      };
    })
    .sort(
      (a, b) =>
        b.rows.reduce((s, r) => s + Math.abs(r.activeWeightDelta ?? 0), 0) -
          a.rows.reduce((s, r) => s + Math.abs(r.activeWeightDelta ?? 0), 0) ||
        a.ticker.localeCompare(b.ticker),
    );
}

export function dailyMoveCounts(
  response: ChangesResponse | undefined,
  asOf: string | undefined,
  category: CategoryChoice,
): { added: number; reduced: number } | null {
  if (!response || response.asOfDate !== asOf) return null;
  return moveCounts(
    response.changes.filter(
      (r) => category === "all" || r.fundCategory === category,
    ),
  );
}
