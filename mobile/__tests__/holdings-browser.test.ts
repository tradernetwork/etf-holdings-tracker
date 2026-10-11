import page from "./fixtures/holdings-page.json";
import msty from "./fixtures/msty-holdings.json";
import {
  buildQuery, catchUpGroups, csvScopeNote, csvUrl, DEFAULT_FILTERS, loadsWhole, narrowKind, paginate, rowType, serverAsset, sortAllowed, SORT_COLUMNS, sortRows, sortValue, summaryLine,
  type HoldingsFilters, type SortKey,
} from "../lib/holdingsBrowser";
import type { HoldingRow } from "../lib/types";

const rows = (msty as unknown as { holdings: HoldingRow[] }).holdings;
const F = (p: Partial<HoldingsFilters>): HoldingsFilters => ({ ...DEFAULT_FILTERS, ...p });

describe("holdings browser: what the server is asked", () => {
  it("pages the unfiltered book and sorts by the server's keys", () => {
    expect(buildQuery(F({ page: 3, size: 50, sort: "weightDelta", dir: "desc" }), { paged: true })).toBe("page=3&size=50&sort=delta&dir=desc");
    expect(buildQuery(F({ sort: "value", dir: "asc" }), { paged: true })).toBe("page=1&size=50&sort=value&dir=asc");
    // A column only the phone can sort adds no server sort.
    expect(buildQuery(F({ sort: "ticker" }), { paged: true })).toBe("page=1&size=50");
  });
  it("loads a narrowed book whole (no paging, no sort) so every column sorts across all rows", () => {
    expect(loadsWhole(F({ fund: "MSTY" }))).toBe(true);
    expect(loadsWhole(F({ q: " nvda " }))).toBe(true);
    expect(loadsWhole(F({ kind: "put" }))).toBe(true);
    expect(loadsWhole(F({ kind: "stock" }))).toBe(false);
    expect(buildQuery(F({ fund: "MSTY", sort: "ticker", page: 4 }), { paged: true })).toBe("fund=MSTY");
    expect(buildQuery(F({ q: " nvda ", kind: "stock" }), { paged: true })).toBe("asset=equity&q=nvda");
    expect(serverAsset("call")).toBe("option");
    expect(serverAsset("all")).toBeUndefined();
  });
  it("offers all 12 columns when whole, only the 4 server ones otherwise", () => {
    expect(SORT_COLUMNS).toHaveLength(12);
    expect(SORT_COLUMNS.filter((c) => sortAllowed(c, F({}))).map((c) => c.key)).toEqual(["weight", "weightDelta", "value", "expiry"]);
    expect(SORT_COLUMNS.every((c) => sortAllowed(c, F({ fund: "AVUV" })))).toBe(true);
  });
  it("builds the uncapped filtered CSV link", () => {
    const u = csvUrl(F({ fund: "MSTY", kind: "option", sort: "value", dir: "desc", page: 9, size: 10 }));
    expect(u).toContain("/api/v1/holdings?fund=MSTY&asset=option&format=csv&sort=value&dir=desc");
    expect(u).not.toContain("page=");
    expect(csvScopeNote({ kind: "put" })).toMatch(/every option row/);
    expect(csvScopeNote({ kind: "stock" })).toBeNull();
  });
});

describe("holdings browser: row typing and local sorting", () => {
  it("types stock, call, put, cash and Treasury rows", () => {
    const types = new Set(rows.map(rowType));
    expect(types.has("CALL")).toBe(true);
    expect(types.has("PUT")).toBe(true);
    expect(types.has("T-BILL") || types.has("CASH")).toBe(true);
    expect(rowType(rows.find((r) => r.isOption && (r.optionType ?? "").toUpperCase().startsWith("P"))!)).toBe("PUT");
  });
  it("narrows calls and puts locally", () => {
    const calls = narrowKind(rows, "call");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((r) => rowType(r) === "CALL")).toBe(true);
    expect(narrowKind(rows, "put").every((r) => rowType(r) === "PUT")).toBe(true);
    expect(narrowKind(rows, "all")).toBe(rows);
  });
  it("sorts every column across all rows, blanks last, in both directions", () => {
    for (const col of SORT_COLUMNS) {
      for (const dir of ["asc", "desc"] as const) {
        const out = sortRows(rows, col.key as SortKey, dir).map((r) => sortValue(r, col.key));
        const firstBlank = out.findIndex((v) => v === null);
        if (firstBlank >= 0) expect(out.slice(firstBlank).every((v) => v === null)).toBe(true);
        const known = out.filter((v): v is string | number => v !== null);
        const cmp = (a: string | number, b: string | number) => (typeof a === "string" || typeof b === "string" ? String(a).localeCompare(String(b)) : Number(a) - Number(b));
        expect(known).toEqual([...known].sort((a, b) => (dir === "asc" ? cmp(a, b) : cmp(b, a))));
      }
    }
  });
  it("shows a catch-up row's deltas as unknown (never zero) and sorts them last", () => {
    const cu = { ...rows[0], catchUpSince: "2026-09-25", sharesDelta: null, activeWeightDelta: null, weightDelta: null } as HoldingRow;
    expect(sortValue(cu, "weightDelta")).toBeNull();
    expect(sortValue(cu, "sharesDelta")).toBeNull();
    const out = sortRows([cu, { ...rows[0], activeWeightDelta: 0.5 } as HoldingRow], "weightDelta", "desc");
    expect(out[1]).toBe(cu);
  });
});

describe("holdings browser: paging and notes", () => {
  it("pages and clamps", () => {
    const a = paginate(rows, 1, 10);
    expect(a.rows).toHaveLength(10);
    expect(a.pages).toBe(Math.ceil(rows.length / 10));
    expect(paginate(rows, 999, 10).page).toBe(a.pages);
    expect(paginate([], 1, 10)).toEqual({ rows: [], page: 1, pages: 1 });
  });
  it("reads the live paged payload", () => {
    const p = page as unknown as { total: number; page: number; pages: number; size: number; count: number; holdings: HoldingRow[] };
    expect(p.page).toBe(2);
    expect(p.size).toBe(20);
    expect(p.count).toBe(20);
    expect(p.pages).toBe(Math.ceil(p.total / 20));
    const deltas = p.holdings.map((h) => h.activeWeightDelta).filter((x): x is number => x != null);
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
  });
  it("groups catch-up funds by since-date and summarises counts", () => {
    expect(catchUpGroups([{ fund: "B", catchUp: true, catchUpSince: "2026-09-25" }, { fund: "A", catchUp: true, catchUpSince: "2026-09-25" }, { fund: "C", catchUp: false }])).toEqual([{ since: "2026-09-25", funds: ["A", "B"] }]);
    expect(summaryLine(20580, "2026-10-09", false)).toBe("20,580 rows · 2026-10-09 file");
    expect(summaryLine(1, null, true)).toBe("1 row · all sortable");
  });
});
