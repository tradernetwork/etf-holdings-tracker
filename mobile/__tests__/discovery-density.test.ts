import fixture from "./fixtures/discovery-changes.json";
import idvoFund from "./fixtures/density-idvo-fund.json";
import fundsFixture from "./fixtures/discovery-funds.json";
import type { Change, FundSummary } from "../lib/types";
import {
  parseCategory,
  scopeChanges,
  scopeLabel,
} from "../lib/discovery/scope";
import { changeSections } from "../lib/discovery/sections";
import { dailyMoveCounts } from "../lib/discovery/derive";
const rows = fixture.changes as Change[];
const funds = new Map(
  (fundsFixture.funds as FundSummary[]).map((f) => [f.fund, f]),
);
funds.set("IDVO", idvoFund as FundSummary);
test("saved category is restored, corrupt/absent settings default to stock-picking funds", () => {
  expect(parseCategory("option-income")).toBe("option-income");
  expect(parseCategory("all")).toBe("all");
  expect(parseCategory(null)).toBe("active-equity");
  expect(parseCategory("equity")).toBe("active-equity");
});
test("IDVO stock collateral is option-income, never active-equity merely because it is a stock", () => {
  const idvo = rows.find((r) => r.fund === "IDVO")!;
  expect(idvo.isOption).toBe(false);
  expect(scopeChanges([idvo], "active-equity", funds)).toEqual([]);
  expect(scopeChanges([idvo], "option-income", funds)).toEqual([idvo]);
  const wrongRowFlag = { ...idvo, fundCategory: "active-equity" as const };
  expect(scopeChanges([wrongRowFlag], "active-equity", funds)).toEqual([]);
});
test("unknown fund category stays unknown in scoped views but is reachable in All; row metadata works offline", () => {
  const unknown = { ...rows[0], fund: "UNKNOWN", fundCategory: undefined };
  expect(scopeChanges([unknown], "active-equity", funds)).toEqual([]);
  expect(scopeChanges([unknown], "all", funds)).toEqual([unknown]);
  expect(
    scopeChanges(rows, "option-income").every(
      (r) => r.fundCategory === "option-income",
    ),
  ).toBe(true);
  expect(scopeLabel("option-income", 2)).toContain("option-income");
  expect(scopeLabel("active-equity", 1)).toContain("active-equity");
});
test("Today and explorer share fund category scope and honest non-null active move counts", () => {
  const source = [
    ...rows,
    { ...rows[0], ticker: "NULL", activeWeightDelta: null },
    { ...rows[0], ticker: "OPTION", isOption: true },
  ];
  for (const category of ["active-equity", "option-income", "all"] as const) {
    const scoped = scopeChanges(source, category, funds).filter(
      (r) => !r.isOption,
    );
    const counts = dailyMoveCounts(
      { ...fixture, changes: source } as any,
      fixture.asOfDate,
      category,
      funds,
    );
    expect(counts).toEqual({
      added: scoped.filter((r) => (r.activeWeightDelta ?? 0) > 0).length,
      reduced: scoped.filter((r) => (r.activeWeightDelta ?? 0) < 0).length,
    });
  }
});
test("sticky provider sections retain every row and preserve within-group ordering", () => {
  expect(changeSections([], funds, false, false, null)).toEqual([]);
  const large = Array.from({ length: 10125 }, (_, i) => ({
    ...rows[i % rows.length],
    ticker: `R${i}`,
  }));
  const grouped = changeSections(large, funds, true, false, null);
  expect(grouped.length).toBeGreaterThan(1);
  const all = grouped.flatMap((s) => s.data);
  expect(all.length).toBe(10125);
  expect(new Set(all.map((r) => r.id)).size).toBe(10125);
  expect(grouped.map((s) => s.title)).toEqual(
    [...grouped.map((s) => s.title)].sort((a, b) => a.localeCompare(b)),
  );
  expect(
    changeSections(large, funds, false, false, null)[0].data.map((i) => i.row),
  ).toEqual(large);
});
test("expanded ticker evidence is virtualized section data, not a capped/nested card", () => {
  const source = rows.filter((r) => !r.isOption);
  const ticker = source[0].ticker;
  const collapsed = changeSections(source, funds, true, true, null);
  const expanded = changeSections(source, funds, true, true, ticker);
  expect(collapsed.find((s) => s.title === ticker)!.data).toHaveLength(1);
  expect(
    expanded
      .find((s) => s.title === ticker)!
      .data.filter((i) => i.row)
      .map((i) => i.row),
  ).toEqual(source.filter((r) => r.ticker === ticker));
});
