import {
  addReduceCounts,
  changesForFund,
  consensusCards,
  convictionFractions,
  mergeSectorFlow,
  splitEvidence,
} from "../lib/derive";
import type { Change, FundSummary, LayeringPattern, Signal } from "../lib/types";

const ch = (o: Partial<Change>): Change => ({
  fund: "AAA", ticker: "X", name: "X", sector: "", activeWeightDelta: 0, weightDelta: 0,
  currentWeight: 0, previousWeight: 0, type: "CHANGED", isOption: false, ...o,
});

test("mergeSectorFlow merges case variants and sorts by magnitude", () => {
  const out = mergeSectorFlow(
    [{ sector: "MATERIALS", delta: 0.234 }, { sector: "Materials", delta: 0.01 }],
    [{ sector: "ENERGY", delta: -0.3 }],
  );
  expect(out.map((r) => r.sector)).toEqual(["Energy", "Materials"]);
  expect(out[1].delta).toBeCloseTo(0.244, 6);
});

test("addReduceCounts ignores options and zero changes", () => {
  const r = addReduceCounts([
    ch({ activeWeightDelta: 0.1 }), ch({ activeWeightDelta: -0.1 }), ch({ activeWeightDelta: -0.2 }),
    ch({ activeWeightDelta: 0 }), ch({ activeWeightDelta: 5, isOption: true }),
  ]);
  expect(r).toEqual({ added: 1, reduced: 2 });
  expect(addReduceCounts(undefined)).toBeNull();
});

test("splitEvidence separates adds from cuts, biggest first", () => {
  const { added, reduced } = splitEvidence([
    ch({ fund: "A", activeWeightDelta: 0.1 }), ch({ fund: "B", activeWeightDelta: 0.6 }),
    ch({ fund: "C", activeWeightDelta: -0.01 }), ch({ fund: "D", activeWeightDelta: -0.5 }),
  ]);
  expect(added.map((c) => c.fund)).toEqual(["B", "A"]);
  expect(reduced.map((c) => c.fund)).toEqual(["D", "C"]);
});

test("changesForFund keeps only that fund's equity rows", () => {
  const rows = changesForFund(
    [ch({ fund: "AVUV", activeWeightDelta: 0.01 }), ch({ fund: "ARKK", activeWeightDelta: 3 }),
     ch({ fund: "AVUV", activeWeightDelta: -0.2 }), ch({ fund: "AVUV", isOption: true, activeWeightDelta: 9 })],
    "AVUV",
  );
  expect(rows.map((c) => c.activeWeightDelta)).toEqual([-0.2, 0.01]);
});

test("convictionFractions scales against the strongest", () => {
  const s = (c: number) => ({ convictionScore: c }) as Signal;
  expect(convictionFractions([s(10), s(5), s(0)])).toEqual([1, 0.5, 0]);
  expect(convictionFractions([])).toEqual([]);
});

describe("consensusCards", () => {
  const funds = [
    { fund: "A1", category: "active-equity" }, { fund: "A2", category: "active-equity" },
    { fund: "A3", category: "active-equity" }, { fund: "O1", category: "option-income" },
  ] as FundSummary[];
  const entry = (fund: string, weight: number, aum: number, positionUsd?: number | null) =>
    ({ fund, provider: fund, entryDate: "2026-10-06", weight, aum, positionUsd }) as never;
  const pattern = (ticker: string, seq: unknown[]): LayeringPattern =>
    ({ ticker, name: ticker, distinctFunds: seq.length, distinctProviders: 1, firstEntry: "2026-10-06",
       lastEntry: "2026-10-06", entrySequence: seq }) as LayeringPattern;

  it("filters by category and estimates dollars from weight x AUM", () => {
    const cards = consensusCards(
      [pattern("T", [entry("A1", 1, 10), entry("A2", 2, 5), entry("A3", 1, 1), entry("O1", 50, 100)])],
      funds, "active-equity",
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].fundCount).toBe(3);
    expect(cards[0].estimated).toBe(true);
    expect(cards[0].usd).toBeCloseTo(0.01 * 10e9 + 0.02 * 5e9 + 0.01 * 1e9, 0);
  });
  it("drops patterns that fall under the minimum after filtering", () => {
    expect(consensusCards([pattern("T", [entry("A1", 1, 1), entry("A2", 1, 1), entry("O1", 1, 1)])], funds, "active-equity")).toEqual([]);
  });
  it("prefers the API's positionUsd when present", () => {
    const cards = consensusCards(
      [pattern("T", [entry("A1", 1, 10, 7e6), entry("A2", 2, 5, 3e6), entry("A3", 1, 1, 1e6)])],
      funds, "all",
    );
    expect(cards[0]).toMatchObject({ usd: 11e6, estimated: false });
  });
});
