import peersFx from "./fixtures/effectiveness-peers.json";
import {
  BOARD_METRICS, boardSummary, firstSentence, LIMITATIONS, METHODOLOGY, metricScore, rankFunds,
} from "../lib/effectiveness-board";
import type { Effectiveness } from "../lib/fundExtras";

const funds = (peersFx as unknown as { funds: Effectiveness[] }).funds;

describe("effectiveness leaderboard", () => {
  it("offers the website's eight metrics, composite first", () => {
    expect(BOARD_METRICS.map((m) => m.key)).toEqual(["composite", "strike", "dte", "spread", "roll", "premium", "hedge", "concentration"]);
  });
  it("ranks every fund best-first by whichever metric is chosen, funds with no score last", () => {
    expect(funds.length).toBeGreaterThan(10);
    for (const m of BOARD_METRICS) {
      const ranked = rankFunds(funds, m.key);
      expect(ranked).toHaveLength(funds.length);
      const scores = ranked.map((f) => metricScore(f, m.key) ?? -1);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });
  it("does not mutate its input and is stable for ties", () => {
    const before = funds.map((f) => f.fund).join();
    rankFunds(funds, "composite");
    expect(funds.map((f) => f.fund).join()).toBe(before);
    const a = { ...funds[0], fund: "AAA", compositeScore: 70 } as Effectiveness;
    const b = { ...funds[0], fund: "BBB", compositeScore: 70 } as Effectiveness;
    expect(rankFunds([a, b], "composite").map((f) => f.fund)).toEqual(["AAA", "BBB"]);
  });
  it("summarises the headline numbers from the same payload", () => {
    const s = boardSummary(funds);
    expect(s.total).toBe(funds.length);
    expect(Object.values(s.byGrade).reduce((a, b) => a + b, 0)).toBe(funds.length);
    expect(s.hedgingMandated).toBe(funds.filter((f) => f.hedgingMandated).length);
    expect(s.averageComposite).not.toBeNull();
    expect(s.peerGroups.length).toBeGreaterThan(1);
    expect(boardSummary([]).averageComposite).toBeNull();
  });
  it("carries the website's methodology and limitations text", () => {
    expect(METHODOLOGY.map((m) => m.title)).toEqual(["Strike Selection", "DTE Management", "Spread Efficiency", "Roll Behavior", "Premium Capture", "Hedge Ratio", "Concentration Risk", "Composite Grade"]);
    expect(METHODOLOGY.every((m) => m.text.length > 100)).toBe(true);
    expect(LIMITATIONS).toHaveLength(4);
    expect(LIMITATIONS[3]).toMatch(/not investment advice/i);
  });
  it("shows a strategy's first sentence", () => {
    expect(firstSentence("Writes weekly calls. Holds treasuries.")).toBe("Writes weekly calls.");
    expect(firstSentence("")).toBe("");
  });
});
