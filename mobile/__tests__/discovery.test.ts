import { completeChanges } from "../lib/discovery/complete-changes";
import changes from "./fixtures/discovery-changes.json";
import stocks from "./fixtures/discovery-stocks.json";
import trend from "./fixtures/discovery-trend.json";
import stock from "./fixtures/discovery-stock.json";
import {
  aggregateChanges,
  dailyMoveCounts,
  filterChanges,
  moveCounts,
  moveType,
  filterStocks,
  trendGroups,
  matrixRows,
  sparkline,
} from "../lib/discovery/derive";
import type { Change, FundSummary } from "../lib/types";
import type {
  StockRow,
  TrendRow,
  HistoryPoint,
  ChangeFilters,
  StockFilters,
} from "../lib/discovery/types";
const rows = changes.changes as Change[];
const map = new Map<string, FundSummary>();
const cf: ChangeFilters = {
  fund: "",
  provider: "",
  sector: "",
  type: "all",
  direction: "all",
  search: "",
};
const sf: StockFilters = {
  provider: "",
  sector: "",
  signal: "all",
  search: "",
  sort: "funds",
};
test("complete changes retain even minor adjustments and compose every filter", () => {
  expect(filterChanges(rows, cf, map)).toHaveLength(rows.length);
  const r = rows.find((r) => (r.activeWeightDelta ?? 0) > 0)!;
  expect(
    filterChanges(
      rows,
      {
        ...cf,
        fund: r.fund,
        sector: r.sector,
        direction: "buying",
        type: moveType(r) as ChangeFilters["type"],
        search: r.ticker,
      },
      map,
    ),
  ).toContainEqual(r);
  expect(filterChanges(rows, { ...cf, search: "NOT A COMPANY" }, map)).toEqual(
    [],
  );
  const providers = new Map([
    [r.fund, { provider: "Real provider" } as FundSummary],
  ]);
  expect(
    filterChanges([r], { ...cf, provider: "Real provider" }, providers),
  ).toEqual([r]);
  expect(
    filterChanges([{ ...r, activeWeightDelta: 0.0001 }], cf, map),
  ).toHaveLength(1);
});
test("movement types use active rather than raw flow and unknown is not zero", () => {
  const b = rows[0];
  expect(moveType({ ...b, type: "NEW" })).toBe("NEW");
  expect(moveType({ ...b, type: "REMOVED" })).toBe("EXIT");
  expect(
    moveType({
      ...b,
      type: "CHANGED",
      activeWeightDelta: 0.1,
      weightDelta: -0.2,
    }),
  ).toBe("ADD");
  expect(moveType({ ...b, type: "CHANGED", activeWeightDelta: -0.1 })).toBe(
    "TRIM",
  );
  expect(moveType({ ...b, type: "CHANGED", activeWeightDelta: null })).toBe(
    "UNKNOWN",
  );
});
test("add/cut counts inspect full rows beyond top fifty, excluding options and unknown catch-up", () => {
  const b = { ...rows[0], isOption: false, type: "CHANGED" };
  expect(
    moveCounts([
      ...Array(55).fill({ ...b, activeWeightDelta: 0.001 }),
      { ...b, activeWeightDelta: -1 },
      { ...b, activeWeightDelta: null },
      { ...b, activeWeightDelta: 2, isOption: true },
    ]),
  ).toEqual({ added: 55, reduced: 1 });
});
test("stocks preserve real columns and sort absolute change and streak with filters", () => {
  const source = stocks.tickers as StockRow[];
  expect(filterStocks(source, sf, map)).toHaveLength(source.length);
  const a = { ...source[0], ticker: "A", netChange: 0.1, streak: 3 },
    b = { ...source[0], ticker: "B", netChange: -2, streak: -5 };
  expect(filterStocks([a, b], { ...sf, sort: "change" }, map)[0]).toEqual(b);
  expect(filterStocks([a, b], { ...sf, sort: "streak" }, map)[0]).toEqual(b);
  expect(filterStocks([a, b], { ...sf, signal: "buying" }, map)).toEqual([a]);
  expect(filterStocks([a, b], { ...sf, signal: "streak" }, map)).toHaveLength(
    2,
  );
  for (const sig of ["new", "exit", "crossfam"] as const) {
    const expected = [a, b].filter((r) =>
      sig === "new"
        ? r.newEntryFunds.length
        : sig === "exit"
          ? r.exitFunds?.length
          : (r.distinctProviders ?? 0) >= 2,
    );
    expect(filterStocks([a, b], { ...sf, signal: sig }, map)).toEqual(expected);
  }
  expect(
    filterStocks([a], { ...sf, sector: "NEVER", search: "NEVER" }, map),
  ).toEqual([]);
});
test("server trend classifications are preserved while horizons change magnitude order and null sinks", () => {
  const src = trend.tickers as TrendRow[];
  expect(trendGroups(src, "all").flatMap((g) => g.rows)).toHaveLength(
    src.length,
  );
  const a = {
      ...src[0],
      ticker: "A",
      daily: 0.1,
      weekly: 4,
      signal: "accumulating" as const,
    },
    b = { ...a, ticker: "B", daily: 2, weekly: 0.1 },
    n = { ...a, ticker: "N", daily: null };
  expect(trendGroups([a, b, n], "daily")[0].rows.map((r) => r.ticker)).toEqual([
    "B",
    "A",
    "N",
  ]);
  expect(trendGroups([a, b], "weekly")[0].rows[0]).toEqual(a);
});
test("matrix preserves all fund/ticker cells, active signs and identities while excluding options/null", () => {
  const b = { ...rows[0], isOption: false, activeWeightDelta: 0.1 };
  const out = matrixRows([
    b,
    { ...b, fund: "SECOND", activeWeightDelta: -0.2, type: "REMOVED" },
    { ...b, ticker: "OPTION", isOption: true },
    { ...b, ticker: "UNKNOWN", activeWeightDelta: null },
  ]);
  expect(out).toHaveLength(1);
  expect(out[0].cells.size).toBe(2);
  expect(out[0].magnitude).toBeCloseTo(0.3);
  expect(out[0].cells.get("SECOND")?.type).toBe("REMOVED");
});
test("sparkline includes every API session with bounded coordinates and handles flat and empty series", () => {
  const pts = stock.history as HistoryPoint[];
  const out = sparkline(pts);
  expect(out).toHaveLength(pts.length);
  expect(out[0].x).toBe(0);
  expect(out.at(-1)?.x).toBe(100);
  expect(out.every((p) => p.y >= 0 && p.y <= 36)).toBe(true);
  expect(sparkline([])).toEqual([]);
  expect(
    sparkline([{ date: "2026-10-09", blendedWeight: 1, fundCount: 1 }]),
  ).toEqual([{ x: 0, y: 18 }]);
});

test("ticker aggregates expose opposing named funds and null-safe dollar totals without losing entry/exit identity", () => {
  const base = { ...rows[0], isOption: false, ticker: "SAME", type: "CHANGED" };
  const input = [
    {
      ...base,
      fund: "ONE",
      activeWeightDelta: 0.1,
      positionUsd: 1000,
      currentShares: 10,
      previousShares: 0,
      sharesDelta: 1,
      type: "NEW",
    },
    {
      ...base,
      fund: "TWO",
      activeWeightDelta: -0.2,
      positionUsd: 1000,
      currentShares: 10,
      previousShares: 11,
      sharesDelta: -0.5,
      type: "REMOVED",
    },
    { ...base, fund: "UNKNOWN", activeWeightDelta: null, positionUsd: null },
  ];
  const out = aggregateChanges(input, map)[0];
  expect(out.buying).toEqual(["ONE"]);
  expect(out.selling).toEqual(["TWO"]);
  expect(out.netDelta).toBeCloseTo(-0.1);
  expect(out.flowUsd).toBe(50);
  expect(out.knownDollarRows).toBe(2);
  expect(out.rows).toHaveLength(3);
  expect(
    aggregateChanges(
      [{ ...base, activeWeightDelta: 0.1, positionUsd: null }],
      map,
    )[0].flowUsd,
  ).toBeNull();
});

// This behavioral test would fail if capped provider responses were used as complete,
// or if duplicate identities/signed deltas were lost during the split.
test("full changes split only capped providers by fund and deduplicate without losing signed deltas", async () => {
  const one = {
      ...rows[0],
      fund: "ONE",
      ticker: "FIRST",
      activeWeightDelta: 0.1,
    },
    two = { ...one, fund: "TWO", ticker: "SECOND", activeWeightDelta: -0.2 };
  const first = { asOfDate: "2026-10-09", count: 5000, changes: [one] };
  const metadata = [
    { fund: "ONE", provider: "House" },
    { fund: "TWO", provider: "House" },
  ] as FundSummary[];
  const calls: unknown[] = [];
  const result = await completeChanges(first, metadata, async (filter) => {
    calls.push(filter);
    return filter.provider
      ? first
      : {
          asOfDate: first.asOfDate,
          count: 1,
          changes: [filter.fund === "ONE" ? one : two],
        };
  });
  expect(result.changes).toHaveLength(2);
  expect(result.truncated).toBe(false);
  expect(result.changes.find((r) => r.fund === "TWO")?.activeWeightDelta).toBe(
    -0.2,
  );
  expect(calls).toEqual([
    { provider: "House" },
    { fund: "ONE" },
    { fund: "TWO" },
  ]);
});
test("uncapped feed makes no extra calls and irreducible fund caps remain disclosed", async () => {
  const first = { asOfDate: "2026-10-09", count: 1, changes: [rows[0]] };
  let calls = 0;
  expect(
    (
      await completeChanges(first, [], async () => {
        calls++;
        return first;
      })
    ).changes,
  ).toEqual(first.changes);
  expect(calls).toBe(0);
  const capped = { ...first, count: 5000 };
  expect(
    (
      await completeChanges(
        capped,
        [{ fund: rows[0].fund, provider: "House" } as FundSummary],
        async () => capped,
      )
    ).truncated,
  ).toBe(true);
});

test("split requests cannot mix a new trading snapshot into the old source", async () => {
  const first = { asOfDate: "2026-10-09", count: 5000, changes: [rows[0]] };
  await expect(
    completeChanges(
      first,
      [{ fund: rows[0].fund, provider: "House" } as FundSummary],
      async () => ({ ...first, asOfDate: "2026-10-12", count: 1 }),
    ),
  ).rejects.toThrow("Snapshot changed");
});

test("unknown-provider funds split by fund rather than using a misleading Other provider query", async () => {
  const first = { asOfDate: "2026-10-09", count: 5000, changes: [rows[0]] };
  const filters: unknown[] = [];
  await completeChanges(
    first,
    [{ fund: rows[0].fund, provider: "Other" } as FundSummary],
    async (filter) => {
      filters.push(filter);
      return { ...first, count: 1 };
    },
  );
  expect(filters).toEqual([{ fund: rows[0].fund }]);
});

test("change column sorts preserve nulls at the bottom in either direction", () => {
  const a = { ...rows[0], ticker: "A", activeWeightDelta: 0.1 },
    b = { ...a, ticker: "B", activeWeightDelta: 2 },
    n = { ...a, ticker: "N", activeWeightDelta: null };
  expect(
    filterChanges([b, a], { ...cf, sort: "ticker", ascending: true }, map).map(
      (r) => r.ticker,
    ),
  ).toEqual(["A", "B"]);
  expect(
    filterChanges(
      [b, a, n],
      { ...cf, sort: "delta", ascending: true },
      map,
    ).map((r) => r.ticker),
  ).toEqual(["A", "B", "N"]);
});

test("Today counts share the complete source but retain category and snapshot identity", () => {
  const base = { ...rows[0], fund: "HACK", type: "CHANGED", isOption: false };
  const response = {
    asOfDate: "2026-10-09",
    count: 2,
    changes: [
      {
        ...base,
        fundCategory: "active-equity" as const,
        activeWeightDelta: 0.1,
      },
      {
        ...base,
        fundCategory: "option-income" as const,
        activeWeightDelta: -0.2,
      },
    ],
  };
  expect(dailyMoveCounts(response, "2026-10-09", "active-equity")).toEqual({
    added: 1,
    reduced: 0,
  });
  expect(dailyMoveCounts(response, "2026-10-09", "all")).toEqual({
    added: 1,
    reduced: 1,
  });
  expect(dailyMoveCounts(response, "2026-10-12", "all")).toBeNull();
  expect(dailyMoveCounts(undefined, "2026-10-09", "all")).toBeNull();
});
