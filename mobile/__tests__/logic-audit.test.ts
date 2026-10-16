import { heroRank, HERO_MIN_TOTAL_PP, isCredibleMove, pickHero } from "../lib/derive";
import { filterChanges, moveCounts, moveLabel, moveType, withoutDrift, emptyChangeFilters } from "../lib/discovery/derive";
import { ACTIVE_EQUITY_FUNDS, OPTION_INCOME_FUNDS, effectiveCategory, scopeChanges } from "../lib/discovery/scope";
import { rankExactFundFirst, resolveSearch } from "../lib/fundDirectory";
import { changeFlowUsd, evidenceTitle, hasReportingFunds, rowPricePerShare, sharesUnchanged, tickerVerdict } from "../lib/tickerView";
import { cleanName } from "../lib/format";
import type { Change, Signal, SignalsResponse } from "../lib/types";

const ch = (o: Partial<Change>): Change => ({
  fund: "AAA", ticker: "X", name: "X", sector: "", activeWeightDelta: 0.1, weightDelta: 0.1,
  currentWeight: 1, previousWeight: 0.9, type: "CHANGED", isOption: false, ...o,
});

describe("1. ticker headline follows the blended signal", () => {
  const quiet = "No change in the latest file.";
  it("SMSN case: funds added, blended move <0.01pp, selling streak => Mixed signals, never 'adding'", () => {
    const v = tickerVerdict({ addedCount: 1, reducedCount: 0, institutional: { signal: "distribution-starting", daily: -0.004, streak: -5 }, quietText: quiet });
    expect(v).toBe("Mixed signals.");
  });
  it("per-fund and blended trend disagree => Mixed signals", () => {
    expect(tickerVerdict({ addedCount: 2, reducedCount: 0, institutional: { signal: "distributing", daily: -0.3, streak: -3 }, quietText: quiet })).toBe("Mixed signals.");
    expect(tickerVerdict({ addedCount: 1, reducedCount: 0, institutional: { signal: "accumulating", daily: 0.3, streak: -2 }, quietText: quiet })).toBe("Mixed signals.");
  });
  it("everything agrees => a one-sided verdict", () => {
    expect(tickerVerdict({ addedCount: 1, reducedCount: 0, institutional: { signal: "accumulating", daily: 0.2, streak: 4 }, quietText: quiet })).toBe("Funds are adding.");
    expect(tickerVerdict({ addedCount: 0, reducedCount: 2, institutional: { signal: "distributing", daily: -0.2, streak: null }, quietText: quiet })).toBe("Funds are trimming.");
  });
  it("tiny blended move and no fund moved => quiet text; falls back to per-fund without institutional data", () => {
    expect(tickerVerdict({ addedCount: 0, reducedCount: 0, institutional: { signal: "bottoming", daily: 0, streak: null }, quietText: quiet })).toBe(quiet);
    expect(tickerVerdict({ addedCount: 1, reducedCount: 0, institutional: null, quietText: quiet })).toBe("Funds are adding.");
    expect(tickerVerdict({ addedCount: 1, reducedCount: 1, institutional: null, quietText: quiet })).toBe("A divided book.");
  });
});

describe("2. flow and exposure share one per-share price", () => {
  // AVEM/SMSN from the audit: $1.43B / 335,196 sh is ~$4,266/sh, so +9,116 sh is ~$38.9M (not $22.2M).
  const smsn = ch({ name: "SAMSUNG ELECTR GDR REG S GDR", positionUsd: 1_430_000_000, currentShares: 335_196, previousShares: 326_080, sharesDelta: 9_116 });
  it("prices the trade at the row's own market value per share", () => {
    expect(rowPricePerShare(smsn)).toBeCloseTo(4266.3, 0);
    expect(changeFlowUsd(smsn)! / 1e6).toBeCloseTo(38.9, 1);
  });
  it("no trustworthy price => no dollar flow, never a wrong one", () => {
    expect(changeFlowUsd({ ...smsn, positionUsd: 0 })).toBeNull();
    expect(changeFlowUsd({ ...smsn, positionUsd: null })).toBeNull();
    expect(changeFlowUsd({ ...smsn, currentShares: 0 })).toBeNull();
    expect(changeFlowUsd({ ...smsn, name: "TOTAL RETURN SWAP ON X" })).toBeNull();
    expect(changeFlowUsd({ ...smsn, sharesDelta: 0, previousShares: 335_196 })).toBeNull();
  });
});

describe("3. Opposite moves title", () => {
  it("only when funds really moved both ways", () => {
    expect(evidenceTitle(1, 1)).toBe("Opposite moves");
    expect(evidenceTitle(2, 0)).toBe("Fund moves");
    expect(evidenceTitle(0, 1)).toBe("Fund moves");
  });
});

describe("4. weight drift is not a trade", () => {
  const aod = ch({ ticker: "AOD", activeWeightDelta: -0.02, previousShares: 2_345_493, currentShares: 2_345_493, sharesDelta: 0 });
  it("unchanged shares => neutral DRIFT tag, never TRIM/ADD", () => {
    expect(sharesUnchanged(aod)).toBe(true);
    expect(moveType(aod)).toBe("DRIFT");
    expect(moveLabel("DRIFT")).toBe("Weight drift");
    expect(moveType({ ...aod, activeWeightDelta: 0.5 })).toBe("DRIFT");
  });
  it("real share changes, entries and exits keep ADD/TRIM/NEW/EXIT; unknown shares are not drift", () => {
    expect(moveType({ ...aod, sharesDelta: -5, currentShares: 2_345_488 })).toBe("TRIM");
    expect(moveType({ ...aod, sharesDelta: 5, activeWeightDelta: 0.1 })).toBe("ADD");
    expect(moveType({ ...aod, type: "NEW", sharesDelta: 0 })).toBe("NEW");
    expect(moveType({ ...aod, type: "REMOVED", sharesDelta: 0 })).toBe("EXIT");
    expect(sharesUnchanged({ ...aod, sharesDelta: undefined, currentShares: null, previousShares: null })).toBe(false);
  });
  it("Changes list hides drift rows by default helper and counts them neither as add nor cut", () => {
    const rows = [aod, ch({ ticker: "B", sharesDelta: 10 }), ch({ ticker: "C", activeWeightDelta: -0.3, sharesDelta: -4 })];
    expect(withoutDrift(rows).map((r) => r.ticker)).toEqual(["B", "C"]);
    expect(moveCounts(rows)).toEqual({ added: 1, reduced: 1 });
    expect(filterChanges(rows, { ...emptyChangeFilters, type: "TRIM" }, new Map()).map((r) => r.ticker)).toEqual(["C"]);
  });
});

describe("5. Active Equity excludes income overlays (mirrors api/data.py)", () => {
  it("mirrors the API override sets", () => {
    expect([...OPTION_INCOME_FUNDS].sort()).toEqual(["DIVO", "IDVO", "QDVO"]);
    expect([...ACTIVE_EQUITY_FUNDS].sort()).toEqual(["CHAT", "DRAM"]);
  });
  it("override beats a stale or provider-level API category", () => {
    expect(effectiveCategory("DIVO", "active-equity")).toBe("option-income");
    expect(effectiveCategory("DRAM", "option-income")).toBe("active-equity");
    expect(effectiveCategory("HACK", "active-equity")).toBe("active-equity");
    expect(effectiveCategory("ZZZ", undefined)).toBeUndefined();
  });
  it("scopeChanges drops DIVO from Active Equity and keeps it in Option-Income", () => {
    const rows = [ch({ fund: "DIVO", fundCategory: "active-equity" }), ch({ fund: "HACK", fundCategory: "active-equity" })];
    expect(scopeChanges(rows, "active-equity").map((r) => r.fund)).toEqual(["HACK"]);
    expect(scopeChanges(rows, "option-income").map((r) => r.fund)).toEqual(["DIVO"]);
    expect(scopeChanges(rows, "all")).toHaveLength(2);
  });
});

describe("6. hero = highest conviction", () => {
  const sig = (ticker: string, direction: "buying" | "selling", deltas: number[]): Signal => ({
    ticker, name: ticker, sector: "", direction, weightDelta: 0, convictionScore: 1, funds: [], fundCount: deltas.length, providerCount: 1,
    fundDetails: deltas.map((d, i) => ({ fund: `F${ticker}${i}`, activeWeightDelta: d, type: "CHANGED" })),
  });
  const resp = (b: Signal[], s: Signal[]): SignalsResponse => ({ asOfDate: "2026-10-09", category: null, stats: {} as never, signals: { buying: b, selling: s }, changes: [] });

  it("tiny single-fund SMSN does not outrank a big move (audit: +0.08 vs +0.60 and -8.77)", () => {
    const hero = pickHero([], resp([sig("SMSN", "buying", [0.08]), sig("ABX", "buying", [0.6])], [sig("IAG", "selling", [-8.77])]));
    expect(hero?.ticker).toBe("IAG");
    expect(hero?.direction).toBe("selling");
  });
  it("multi-fund agreement ranks first, then absolute size", () => {
    const hero = pickHero([], resp([sig("ABX", "buying", [0.6]), sig("TWO", "buying", [0.15, 0.12])], [sig("IAG", "selling", [-8.77])]));
    expect(hero?.ticker).toBe("TWO");
    const same = pickHero([], resp([sig("A", "buying", [0.3, 0.3]), sig("B", "buying", [0.2, 0.9])], []));
    expect(same?.ticker).toBe("B");
  });
  it("minimum significance applies; if nothing qualifies the biggest still shows", () => {
    expect(heroRank(sig("T", "buying", [0.08])).eligible).toBe(false);
    expect(HERO_MIN_TOTAL_PP).toBe(0.1);
    expect(heroRank(sig("T", "buying", [0.1])).eligible).toBe(true);
    expect(pickHero([], resp([sig("S1", "buying", [0.05]), sig("S2", "buying", [0.07])], []))?.ticker).toBe("S2");
    expect(pickHero([], resp([], []))).toBeNull();
  });
  it("a selling hero reports the sellers under 'reduced'", () => {
    const hero = pickHero([], resp([], [sig("IAG", "selling", [-8.77])]));
    expect(hero?.reduced).toEqual([{ fund: "FIAG0", delta: -8.77 }]);
    expect(hero?.added).toEqual([]);
  });
});

describe("6b. hero never promotes an impossible fund move", () => {
  // Live 2026-10-15: AVIV/IAG active -8.774pp on a 0.3642% position (raw -0.1779pp, 98% share cut, 0.1863% left).
  const iag: Signal = {
    ticker: "IAG", name: "IA FINANCIAL", sector: "Financials", direction: "selling", weightDelta: -8.774, convictionScore: 17.5, funds: ["AVIV"], fundCount: 1, providerCount: 1,
    fundDetails: [{ fund: "AVIV", activeWeightDelta: -8.774, rawWeightDelta: -0.1779, currentWeight: 0.1863, type: "CHANGED" }],
  };
  const real = (ticker: string, d: number): Signal => ({
    ticker, name: ticker, sector: "", direction: "buying", weightDelta: d, convictionScore: 1, funds: [], fundCount: 1, providerCount: 1,
    fundDetails: [{ fund: "ARKK", activeWeightDelta: d, rawWeightDelta: d, currentWeight: 3, type: "CHANGED" }],
  });
  const resp = (b: Signal[], s: Signal[], changes: SignalsResponse["changes"] = []): SignalsResponse =>
    ({ asOfDate: "2026-10-15", category: null, stats: {} as never, signals: { buying: b, selling: s }, changes });
  const iagChange = { fund: "AVIV", ticker: "IAG", name: "IAG", sector: "", activeWeightDelta: -8.774, weightDelta: -0.1779, currentWeight: 0.1863, previousWeight: 0.3642, type: "CHANGED", isOption: false } as const;

  it("rejects AVIV/IAG by previous weight (changes row) and by derived previous weight", () => {
    expect(isCredibleMove(iag.fundDetails[0], 0.3642)).toBe(false);
    expect(isCredibleMove(iag.fundDetails[0])).toBe(false);
  });
  it("rejects via the raw-delta fallback when no weights exist", () => {
    expect(isCredibleMove({ fund: "F", activeWeightDelta: -8.774, rawWeightDelta: -0.1779 })).toBe(false);
    expect(isCredibleMove({ fund: "F", activeWeightDelta: -0.9, rawWeightDelta: -0.01 })).toBe(true); // under the 1.0pp floor
    expect(isCredibleMove({ fund: "F", activeWeightDelta: -2, rawWeightDelta: -0.5 })).toBe(true); // within 5x raw
  });
  it("a real exit (sold the whole position) stays credible", () => {
    expect(isCredibleMove({ fund: "F", activeWeightDelta: -2.95, rawWeightDelta: -3.0, currentWeight: 0 }, 3.0)).toBe(true);
  });
  it("IAG is not the hero; the credible story wins", () => {
    const hero = pickHero([], resp([real("ABX", 0.4)], [iag], [iagChange]));
    expect(hero?.ticker).toBe("ABX");
    expect(heroRank(iag, [iagChange])).toMatchObject({ agree: 0, size: 0, credible: 0, eligible: false });
  });
  it("only impossible candidates => no hero rather than a fake one", () => {
    expect(pickHero([], resp([], [iag], [iagChange]))).toBeNull();
  });
  it("an impossible fund row does not inflate a mixed signal's size or rows", () => {
    const mixed: Signal = { ...iag, ticker: "MIX", fundDetails: [...iag.fundDetails, { fund: "AVUV", activeWeightDelta: -0.3, rawWeightDelta: -0.3, currentWeight: 1, type: "CHANGED" }] };
    expect(heroRank(mixed).size).toBeCloseTo(0.3);
    const hero = pickHero([], resp([], [mixed]));
    expect(hero?.reduced).toEqual([{ fund: "AVUV", delta: -0.3 }]);
  });
});

describe("7. search routes fund tickers to the fund page", () => {
  const funds = [{ fund: "ARKQ" }, { fund: "ARKK" }, { fund: "AVUV" }];
  it("ARKK is a fund, never a ticker lookup", () => {
    expect(resolveSearch("arkk", funds)).toEqual({ fund: "ARKK", ticker: null });
  });
  it("a non-fund ticker-shaped query is a stock lookup; junk is nothing", () => {
    expect(resolveSearch("tsla", funds)).toEqual({ fund: null, ticker: "TSLA" });
    expect(resolveSearch("a b c", funds)).toEqual({ fund: null, ticker: null });
    expect(resolveSearch("  ", funds)).toEqual({ fund: null, ticker: null });
  });
  it("the exact fund ranks first", () => {
    expect(rankExactFundFirst(funds, "arkk").map((f) => f.fund)).toEqual(["ARKK", "ARKQ", "AVUV"]);
  });
  it("a ticker page with zero reporting funds says nothing directional", () => {
    expect(hasReportingFunds(0)).toBe(false);
    expect(hasReportingFunds(3)).toBe(true);
  });
});

describe("8. names are never cut by code", () => {
  it("cleanName does not impose a length cap (the 14-char 'Samsung Electr' is the source string)", () => {
    expect(cleanName("SAMSUNG ELECTRONICS CO LTD")).toBe("Samsung Electronics Co Ltd");
    expect(cleanName("A VERY LONG COMPANY NAME HOLDINGS GROUP PLC").length).toBeGreaterThan(30);
  });
});
