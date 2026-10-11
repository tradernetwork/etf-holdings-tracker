import changes from "./fixtures/changes-daily.json";
import fundsFx from "./fixtures/funds-live.json";
import signalsFx from "./fixtures/signals-limit5.json";
import ulti from "./fixtures/ulti-rotation.json";
import { formatShareMove } from "../lib/format";
import { buildFundActivity, buildTopMovers, directoryHeadline, sortFunds, type DirectoryFund } from "../lib/fundDirectory";
import { categoryParam, DEFAULT_ACTIVITY_FILTERS, filterActivity, PERIOD_LABEL } from "../lib/options/logic";
import { cellDetail, cellLabel, churnPercent } from "../lib/rotation";
import { fundFlowUsd, signalFlowUsd } from "../lib/today/logic";
import type { FullSignal } from "../lib/today/types";
import type { Change } from "../lib/types";
import { activityTitle, dayWord, inFile, isToday, latestFileDate } from "../lib/when";
import { metricCards } from "../lib/effectiveness";
import kqqqEff from "./fixtures/kqqq-effectiveness.json";

const NOW = new Date(2026, 9, 11, 12, 0, 0); // Sun Oct 11 2026

describe("rotation numbers", () => {
  it("prints the churn fraction as a percent (live ULTI 0.62 -> 62%)", () => {
    expect((ulti as { churnSincePrior: { rate: number } }).churnSincePrior.rate).toBe(0.62);
    expect(churnPercent((ulti as { churnSincePrior: { rate: number } }).churnSincePrior.rate)).toBe(62);
    expect(churnPercent(0)).toBe(0);
    expect(churnPercent(1)).toBe(100);
    expect(churnPercent(0.005)).toBe(1);
  });
  it("shows heatmap weights from 5% up and keeps the tooltip as detail", () => {
    expect(cellLabel(73.4)).toBe("73");
    expect(cellLabel(5)).toBe("5");
    expect(cellLabel(4.9)).toBe("");
    expect(cellDetail("Bitcoin miners", "2026-07-21", 5.52)).toBe("Bitcoin miners · 2026-07-21: 5.5%");
  });
});

describe("other ratio-vs-percent formatters", () => {
  it("prints the hedge cost ratio (a fraction) as % of gross, like the website", () => {
    const eff = kqqqEff as unknown as { premiumCapture: { hedgeCostRatio: number } };
    expect(eff.premiumCapture.hedgeCostRatio).toBeCloseTo(1.303, 2);
    const rows = metricCards(kqqqEff as never).flatMap((c) => c.rows);
    expect(rows).toContainEqual(["Hedge cost ratio", "130% of gross"]);
  });
});

describe("income activity scope", () => {
  it("pre-filters to option-income from the link", () => {
    expect(categoryParam("option-income")).toBe("option-income");
    expect(categoryParam(["active-equity"])).toBe("active-equity");
    expect(categoryParam("nonsense")).toBe("all");
    expect(categoryParam(undefined)).toBe("all");
    const recs = [
      { fund: "A", fundCategory: "option-income", ticker: "x", isOption: true, type: "NEW" },
      { fund: "B", fundCategory: "active-equity", ticker: "y", isOption: true, type: "NEW" },
    ] as never[];
    expect(filterActivity(recs, { ...DEFAULT_ACTIVITY_FILTERS, category: categoryParam("option-income") })).toHaveLength(1);
  });
});

describe("honest 'today' wording", () => {
  it("says today only when the data is from today", () => {
    expect(isToday("2026-10-11", NOW)).toBe(true);
    expect(isToday("2026-10-09", NOW)).toBe(false);
    expect(dayWord("2026-10-11", NOW)).toBe("today");
    expect(dayWord("2026-10-09", NOW)).toBe("Oct 9");
    expect(dayWord(null, NOW)).toBe("the latest file");
    expect(inFile("2026-10-09", NOW)).toBe("in the Oct 9 file");
    expect(inFile("2026-10-11", NOW)).toBe("today");
    expect(inFile(undefined, NOW)).toBe("in the latest file");
    expect(activityTitle("2026-10-09", NOW)).toBe("Option activity · Oct 9");
    expect(activityTitle("2026-10-11", NOW)).toBe("Option activity today");
    expect(PERIOD_LABEL.daily).toBe("Latest day");
  });
  it("finds the newest file date among holdings", () => {
    expect(latestFileDate([{ fileDate: "2026-09-25" }, { fileDate: "2026-10-09" }, {}])).toBe("2026-10-09");
    expect(latestFileDate([])).toBeNull();
  });
});

describe("estimated active-flow dollars", () => {
  const signals = (signalsFx as unknown as { signals: { buying: FullSignal[] } }).signals.buying;
  it("is active weight x AUM per fund, summed over funds with a known AUM", () => {
    expect(fundFlowUsd({ activeWeightDelta: 1, aumUsd: 1_000_000_000, aum: null })).toBe(10_000_000);
    expect(fundFlowUsd({ activeWeightDelta: -0.5, aum: 2 })).toBe(-10_000_000);
    expect(fundFlowUsd({ activeWeightDelta: 1, aum: null })).toBeNull();
    const s = signals[0];
    const total = signalFlowUsd(s)!;
    expect(total).toBe(s.fundDetails.reduce((a, f) => a + (fundFlowUsd(f) ?? 0), 0));
    expect(signalFlowUsd({ fundDetails: [] })).toBeNull();
  });
});

describe("share quantities in change rows", () => {
  it("shows previous -> current", () => {
    expect(formatShareMove(1200, 1500)).toBe("1,200 → 1,500 sh");
    expect(formatShareMove(0, 70000)).toBe("0 → 70,000 sh");
    expect(formatShareMove(5000, 0)).toBe("5,000 → 0 sh");
    expect(formatShareMove(null, null)).toBeNull();
    const withShares = (changes as unknown as { changes: Change[] }).changes.find((c) => c.previousShares != null && c.currentShares != null);
    expect(withShares).toBeDefined();
  });
});

describe("fund directory", () => {
  const funds = (fundsFx as unknown as { funds: DirectoryFund[] }).funds;
  const ch = (changes as unknown as { changes: Change[] }).changes;
  it("sorts by AUM, holdings and name", () => {
    expect((sortFunds(funds, "aum")[0].aum ?? 0)).toBeGreaterThanOrEqual(sortFunds(funds, "aum")[1].aum ?? 0);
    expect(sortFunds(funds, "holdings")[0].holdingsCount).toBeGreaterThanOrEqual(sortFunds(funds, "holdings")[1].holdingsCount);
    const n = sortFunds(funds, "name").map((f) => f.fund);
    expect(n).toEqual([...n].sort((a, b) => a.localeCompare(b)));
  });
  it("carries holdings, options and the top holding from /funds", () => {
    const f = funds.find((x) => x.topHolding)!;
    expect(f.topHolding!.weight).toBeGreaterThan(0);
    expect(typeof f.holdingsCount).toBe("number");
    expect(typeof f.optionsCount).toBe("number");
  });
  it("finds each fund's top move and its add/trim counts, ignoring options and unknown deltas", () => {
    const movers = buildTopMovers(ch);
    const act = buildFundActivity(ch);
    for (const [fund, m] of movers) {
      const own = ch.filter((c) => c.fund === fund && !c.isOption && c.activeWeightDelta != null && c.activeWeightDelta !== 0);
      expect(Math.abs(m.delta)).toBe(Math.max(...own.map((c) => Math.abs(c.activeWeightDelta as number))));
      const a = act.get(fund)!;
      expect(a.buys + a.sells).toBe(own.length);
    }
    const unknown = { fund: "ZZZ", ticker: "T", isOption: false, activeWeightDelta: null, type: "CHANGED" } as unknown as Change;
    expect(buildTopMovers([unknown]).size).toBe(0);
  });
  it("summarises the visible list", () => {
    expect(directoryHeadline([{ fund: "A", provider: "X", aum: 1.5 }, { fund: "B", provider: "X", aum: 0.25 }] as DirectoryFund[])).toBe("2 funds · 1 provider · $1.8B combined AUM");
    expect(directoryHeadline([{ fund: "A", provider: "X", aum: 0.085 }] as DirectoryFund[])).toBe("1 fund · 1 provider · $85M combined AUM");
  });
});
