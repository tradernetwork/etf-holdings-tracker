import {
  addReduceCounts,
  changesForFund,
  alsoWorthLook,
  consensusCards,
  evidenceNote,
  pickHero,
  tickerEvidence,
  convictionFractions,
  mergeSectorFlow,
  splitEvidence,
} from "../lib/derive";
import type { Change, Divergence, FundSummary, LayeringPattern, Signal, SignalsResponse } from "../lib/types";

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
    expect(cards[0].funds).toEqual(["A1", "A2", "A3"]);
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

describe("evidenceNote", () => {
  it("explains a reduction hidden by price drift", () => {
    const n = evidenceNote(ch({ activeWeightDelta: -0.0104, weightDelta: 0.0616, sharesDelta: 7502 }));
    expect(n).toBe("Raw weight rose +0.06 pp. Price drift can hide a relative reduction.");
  });
  it("otherwise reports the share change", () => {
    expect(evidenceNote(ch({ activeWeightDelta: 0.5959, weightDelta: 0.6271, sharesDelta: 209486 }))).toBe(
      "Reported share change: +209,486. Active weight removes price drift.",
    );
  });
});

test("evidenceNote handles an unchanged share count", () => {
  expect(evidenceNote(ch({ activeWeightDelta: 0.001, weightDelta: 0.002, sharesDelta: 0 }))).toBe(
    "Reported share count unchanged. Active weight removes price drift.",
  );
});

describe("pickHero / alsoWorthLook", () => {
  const sig = (ticker: string, direction: "buying" | "selling", delta: number, extra: Partial<Signal> = {}): Signal =>
    ({ ticker, name: ticker, sector: "Tech", direction, weightDelta: delta, convictionScore: 1, funds: ["F"], fundCount: 1,
       providerCount: 1, fundDetails: [{ fund: "F", activeWeightDelta: delta, type: "CHANGED" }], ...extra }) as Signal;
  const resp = (buying: Signal[], selling: Signal[]): SignalsResponse =>
    ({ asOfDate: "2026-10-09", category: null, stats: {} as never, signals: { buying, selling }, changes: [] });

  it("prefers a divergence and carries the streak", () => {
    const div = [{ ticker: "AAPL", name: "Apple", buyingFunds: [{ fund: "CGGO", weightDelta: 0.596 }], sellingFunds: [{ fund: "AVUS", weightDelta: -0.01 }] }] as Divergence[];
    const hero = pickHero(div, resp([sig("AAPL", "buying", 0.6, { streak: 2 }), sig("DE", "buying", 0.3)], []));
    expect(hero).toMatchObject({ ticker: "AAPL", countercase: true, streak: { days: 2, direction: "buying" } });
    expect(hero?.added[0]).toEqual({ fund: "CGGO", delta: 0.596 });
    expect(hero?.reduced[0]).toEqual({ fund: "AVUS", delta: -0.01 });
  });
  it("falls back to the top buy when there is no divergence", () => {
    const hero = pickHero([], resp([sig("DE", "buying", 0.3)], []));
    expect(hero).toMatchObject({ ticker: "DE", countercase: false, reduced: [] });
    expect(pickHero([], resp([], []))).toBeNull();
  });
  it("lists the next moves, skipping the hero, buys and sells interleaved", () => {
    const rows = alsoWorthLook(
      resp([sig("AAPL", "buying", 0.6), sig("DE", "buying", 0.3, { fundDetails: [{ fund: "CGGO", activeWeightDelta: 0.3, type: "NEW" }] as never })],
           [sig("NVDA", "selling", -0.5)]),
      "AAPL",
    );
    expect(rows.map((r) => r.ticker)).toEqual(["DE", "NVDA"]);
    expect(rows[0]).toMatchObject({ title: "A new position", sub: "CGGO entered DE" });
    expect(rows[1].title).toBe("Allocation reduced");
  });
});

test("tickerEvidence applies the API's per-fund significance thresholds", () => {
  const r = tickerEvidence([
    ch({ fund: "ARKK", activeWeightDelta: 0.015 }),   // concentrated: needs 0.02 -> minor
    ch({ fund: "ARKK", activeWeightDelta: 0.02 }),    // exactly at threshold -> significant
    ch({ fund: "AVUS", activeWeightDelta: -0.0104 }), // broad: 0.01 -> significant
    ch({ fund: "AVUS", activeWeightDelta: -0.004 }),  // minor
    ch({ fund: "CMAG", activeWeightDelta: 0.001 }),   // minor
    ch({ fund: "CGGO", activeWeightDelta: 0.5959 }),
    ch({ fund: "OPT", activeWeightDelta: 3, isOption: true }),
  ]);
  expect(r.added.map((c) => c.fund)).toEqual(["CGGO", "ARKK"]);
  expect(r.reduced.map((c) => c.fund)).toEqual(["AVUS"]);
  expect(r.minor).toHaveLength(3);
});
