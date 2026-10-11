import { describeTrade, activitySummary, dayStatus, formatDay, legChange, legName } from "../lib/activity";
import { currentBars, groupColor, hexAlpha, maxCell, rotationTitle, sortedGroups } from "../lib/rotation";
import { gradeTone, metricCards, peerComparison, scoreTone, weightLines, effectivenessFacts } from "../lib/effectiveness";
import { deltaOf, splitPeriod } from "../lib/fundChanges";
import type { Effectiveness, IncomeFundResponse, OptionActivityDay, RotationData } from "../lib/fundExtras";
import {
  coverageClass, incomeNotices, noCoverageMessage, deriveRows, expiryLadder, filterRows, legMeta, NO_FILTERS, openedDates, openedLabel, optionOnlyPositions, qtyNote, sectorsOf, sortRows, topSector, liveLegCount, filtersActive,
} from "../lib/incomeBook";
import type { Change } from "../lib/types";
import avuvChanges from "./fixtures/avuv-changes-weekly.json";
import kqqq from "./fixtures/kqqq-income.json";
import mstyEff from "./fixtures/msty-effectiveness.json";
import mstyIncome from "./fixtures/msty-income.json";
import peers from "./fixtures/peers.json";
import ultyRotation from "./fixtures/ulty-rotation.json";
import qdteIncome from "./fixtures/qdte-income.json";

// Fixtures are live-API captures (2026-10-09/10 snapshots).
const msty = mstyIncome as unknown as IncomeFundResponse;
const kq = kqqq as unknown as IncomeFundResponse;
const eff = mstyEff as unknown as Effectiveness;
const rot = ultyRotation as unknown as RotationData;
const ch = (o: Partial<Change>): Change => ({
  fund: "F", ticker: "X", name: "X", sector: "", activeWeightDelta: 0, weightDelta: 0, currentWeight: 0, previousWeight: 0, type: "CHANGED", isOption: false, ...o,
});

describe("income portfolio rows (website fund-positions)", () => {
  const rows = deriveRows(msty.positions!, []);
  it("MSTY: one synthetic MSTR position, 0% held outright, 100% synthetic", () => {
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.p.ticker).toBe("MSTR");
    expect(r.p.sharesHeld).toBe(0);
    expect(qtyNote(r.p)).toBe("all synthetic");
    expect(r.p.legs.length).toBeGreaterThan(10);
    expect(msty.positionsSummary!.syntheticPct).toBe(100);
    expect(msty.positionsSummary!.coveredPct).toBe(38);
  });
  it("derives upside, ITM, soonest written DTE and NAV%", () => {
    const r = rows[0];
    expect(r.dte).toBe(0); // the 10/09 written calls expire on the snapshot date
    expect(r.navPct).toBeCloseTo(103.74, 1);
    expect(typeof r.itm).toBe("boolean");
  });
  it("coverage filter buckets: full >=90, partial (0,90), none = 0/unknown", () => {
    const mk = (cov: number | null) => deriveRows([{ ...msty.positions![0], ticker: `T${cov}`, coveragePct: cov }], [])[0];
    const all = [mk(100), mk(50), mk(0), mk(null)];
    const by = (cov: "full" | "partial" | "none") => filterRows(all, { ...NO_FILTERS, cov }).map((r) => r.p.ticker);
    expect(by("full")).toEqual(["T100"]);
    expect(by("partial")).toEqual(["T50"]);
    expect(by("none")).toEqual(["T0", "Tnull"]);
  });
  it("toggle filters: synthetic, itm, expiring <= 7d, changed today", () => {
    const base = msty.positions![0];
    const a = deriveRows([{ ...base, ticker: "SYN", syntheticShares: 10 }], [])[0];
    const b = deriveRows([{ ...base, ticker: "REAL", syntheticShares: 0, legs: [] }], [ch({ ticker: "REAL", type: "CHANGED", sharesDelta: 5 })])[0];
    expect(filterRows([a, b], { ...NO_FILTERS, toggles: new Set(["synthetic"]) }).map((r) => r.p.ticker)).toEqual(["SYN"]);
    expect(filterRows([a, b], { ...NO_FILTERS, toggles: new Set(["changed"]) }).map((r) => r.p.ticker)).toEqual(["REAL"]);
    expect(filterRows([a, b], { ...NO_FILTERS, toggles: new Set(["expiring"]) }).map((r) => r.p.ticker)).toEqual(["SYN"]);
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, q: "x" })).toBe(true);
  });
  it("search matches ticker or name, sector filter is exact", () => {
    expect(filterRows(rows, { ...NO_FILTERS, q: "mstr" })).toHaveLength(1);
    expect(filterRows(rows, { ...NO_FILTERS, q: "zzz" })).toHaveLength(0);
    expect(sectorsOf(rows).length).toBeGreaterThan(0);
    expect(topSector(rows)).not.toBe("Unclassified");
  });
  it("nine sorts, missing values sink either way", () => {
    const base = msty.positions![0];
    const mk = (t: string, o: Partial<typeof base>) => deriveRows([{ ...base, ticker: t, ...o }], [])[0];
    const rs = [mk("A", { price: 5, exposureValue: 10 }), mk("B", { price: null, exposureValue: 30 }), mk("C", { price: 9, exposureValue: 20 })];
    expect(sortRows(rs, "price", "desc").map((r) => r.p.ticker)).toEqual(["C", "A", "B"]);
    expect(sortRows(rs, "price", "asc").map((r) => r.p.ticker)).toEqual(["A", "C", "B"]);
    expect(sortRows(rs, "value").map((r) => r.p.ticker)).toEqual(["B", "C", "A"]);
    expect(sortRows(rs, "symbol").map((r) => r.p.ticker)).toEqual(["A", "B", "C"]);
    for (const k of ["symbol", "qty", "price", "value", "nav", "delta", "coverage", "upside", "dte"] as const) expect(() => sortRows(rs, k)).not.toThrow();
  });
  it("expiry ladder groups live legs by expiry, soonest first, excluding expired", () => {
    const ladder = expiryLadder(rows);
    const exps = ladder.map((g) => g.expiry);
    expect(exps).toEqual([...exps].sort());
    expect(ladder.reduce((n, g) => n + g.legs.length, 0)).toBe(liveLegCount(msty.positions!));
    const withExpired = deriveRows([{ ...msty.positions![0], legs: [{ ...msty.positions![0].legs[0], expired: true }, ...msty.positions![0].legs.slice(1)] }], []);
    expect(expiryLadder(withExpired).reduce((n, g) => n + g.legs.length, 0)).toBe(liveLegCount(msty.positions!) - (msty.positions![0].legs[0].expired ? 0 : 1));
  });
  it("opened dates come from the activity timeline; older legs get none", () => {
    const opened = openedDates(msty.optionActivity);
    expect(opened.size).toBeGreaterThan(0);
    expect(openedLabel("2026-10-06")).toBe("opened 10/6");
    const leg = msty.positions![0].legs[0];
    expect(legMeta(leg, "2026-10-06")).toContain("opened 10/6");
    expect(legMeta({ ...leg, expired: true, upsideRoomPct: -2 })).toMatch(/expired · ITM by 2.0%/);
  });
  it("options-only positions are listed separately; KQQQ has stock + legs", () => {
    expect(optionOnlyPositions([{ ...msty.positions![0], totalShares: 0 }])).toHaveLength(1);
    expect(kq.positions!.length).toBeGreaterThan(1);
    expect(deriveRows(kq.positions!, []).some((r) => r.p.sharesHeld !== 0 || r.p.syntheticShares !== 0)).toBe(true);
  });
  it("other positions (cash/treasury) keep value, weight and line count", () => {
    expect(msty.otherPositions!.map((o) => o.sleeve)).toEqual(["treasury", "cash"]);
    expect(msty.otherPositions![0].lines).toBe(5);
  });
});

describe("option activity (website option-activity)", () => {
  const days = msty.optionActivity as OptionActivityDay[];
  it("describes every trade kind present in a live MSTY capture without throwing", () => {
    const kinds = new Set<string>();
    for (const d of days) for (const t of d.trades) { const x = describeTrade(t); kinds.add(x.badge); expect(x.text.length).toBeGreaterThan(0); }
    expect([...kinds]).toEqual(expect.arrayContaining(["Roll", "Spread", "Synthetic"]));
  });
  it("a roll names the closed and the opened leg", () => {
    const t = days.flatMap((d) => d.trades).find((x) => x.kind === "roll")!;
    const x = describeTrade(t);
    expect(x.from).toBeTruthy();
    expect(x.to).toBeTruthy();
    expect(x.text).toContain("→");
  });
  it("shows signed change and previous → current contracts per leg, with FLEX", () => {
    const t = days.flatMap((d) => d.trades).find((x) => x.legs.some((l) => l.isFlex))!;
    const l = t.legs.find((x) => x.isFlex)!;
    expect(legChange(l)).toMatch(/\(\d[\d,]* → \d[\d,]*\) FLEX$/);
    expect(legName({ ...l, strike: 152.5, optionType: "CALL", expiry: "2026-10-16" })).toBe("152.5C 10/16/26");
  });
  it("summary pluralises structures and not actions; carried days say so", () => {
    const sum = activitySummary(days);
    expect(sum.some((s) => /rolls?$/.test(s))).toBe(true);
    expect(dayStatus({ date: "2026-10-09", compareDate: "2026-10-08", refreshed: false, trades: [] })).toBe("not refreshed: issuer file unavailable");
    expect(dayStatus({ date: "x", compareDate: "y", refreshed: true, trades: [] })).toBe("no option trades");
    expect(formatDay("2026-10-09")).toBe("Fri, Oct 9");
  });
});

describe("effectiveness (website fund-effectiveness)", () => {
  it("surfaces every metric, each with its score and labelled rows", () => {
    const cards = metricCards(eff);
    expect(cards.map((c) => c.key)).toEqual(["strikeSelection", "dteManagement", "spreadEfficiency", "rollBehavior", "premiumCapture", "hedgeRatio", "concentrationRisk"]);
    expect(cards.every((c) => c.rows.length >= 3 && c.rows.every(([l, v]) => l && v))).toBe(true);
    expect(cards[0].bars!.map((b) => b.label)).toEqual(["Deep OTM", "Slightly OTM", "ATM", "ITM"]);
    expect(cards[2].lists![0].lines.length).toBe(eff.spreadEfficiency.spreads.length);
    expect(cards[3].lists![0].lines.length).toBe(eff.rollBehavior.recentRolls.length);
    expect(cards.find((c) => c.key === "premiumCapture")!.rows[0]).toEqual(["Premium written", "$23.6M"]);
  });
  it("tones, facts and weights", () => {
    expect(scoreTone(85)).toBe("good"); expect(scoreTone(60)).toBe("ok"); expect(scoreTone(40)).toBe("warn"); expect(scoreTone(10)).toBe("bad"); expect(scoreTone(null)).toBe("none");
    expect(gradeTone("A")).toBe("good"); expect(gradeTone("F")).toBe("bad"); expect(gradeTone("N/A")).toBe("none");
    expect(effectivenessFacts(eff).map(([l]) => l)).toEqual(expect.arrayContaining(["Composite score", "Peer group", "Write cadence", "Hedging mandated"]));
    const w = weightLines(eff);
    expect(w).toHaveLength(7);
    expect(w[0]).toMatch(/\d+\.\d%$/);
  });
  it("ranks the fund among peers with per-metric rank", () => {
    const pc = peerComparison((peers as unknown as { funds: Effectiveness[] }).funds, "MSTY")!;
    expect(pc.total).toBe((peers as unknown as { funds: Effectiveness[] }).funds.length);
    expect(pc.ranking.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(pc.ranking.map((r) => r.score)).toEqual([...pc.ranking.map((r) => r.score)].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(pc.metrics).toHaveLength(7);
    expect(peerComparison([], "MSTY")).toBeNull();
  });
});

describe("rotation report (ULTY)", () => {
  it("orders groups by weight with Uncategorized last, and colours them stably", () => {
    const g = sortedGroups(rot);
    if (g.includes("Uncategorized")) expect(g[g.length - 1]).toBe("Uncategorized");
    expect(groupColor("Uncategorized", g)).toBe("#64748b");
    expect(groupColor(g[0], g)).toBe("#f7931a");
    expect(currentBars(rot).every((b) => b.weight > 0)).toBe(true);
    expect(rotationTitle(rot)).toMatch(/ rotation$/);
    expect(maxCell(rot)).toBeGreaterThanOrEqual(1);
    expect(hexAlpha("#ffffff", 0.5)).toBe("#ffffff80");
    expect(rot.churnSincePrior.rate).toBeGreaterThanOrEqual(0);
  });
});

describe("period changes (website ActiveEquityBody)", () => {
  const split = splitPeriod((avuvChanges as unknown as { changes: Change[] }).changes);
  it("splits entrances, exits, increased and trimmed, ranked by active weight", () => {
    const all = split.entrances.length + split.exits.length + split.increased.length + split.trimmed.length + split.unknown;
    expect(all).toBe((avuvChanges as unknown as { changes: Change[] }).changes.filter((c) => !c.isOption).length);
    const inc = split.increased.map((c) => deltaOf(c)!);
    expect(inc).toEqual([...inc].sort((a, b) => b - a));
    const tr = split.trimmed.map((c) => deltaOf(c)!);
    expect(tr).toEqual([...tr].sort((a, b) => a - b));
  });
  it("null deltas (catch-up) are counted as unknown, never as a move", () => {
    const s = splitPeriod([ch({ activeWeightDelta: null, weightDelta: null }), ch({ activeWeightDelta: 0.5 }), ch({ type: "NEW" })]);
    expect(s.unknown).toBe(1);
    expect(s.increased).toHaveLength(1);
    expect(s.entrances).toHaveLength(1);
    expect(deltaOf(ch({ activeWeightDelta: null, weightDelta: 0.2 }))).toBe(0.2);
  });
});

describe("data notices and coverage class (QDTE: intraday income leg is invisible)", () => {
  const qd = qdteIncome as unknown as IncomeFundResponse;
  it("QDTE shows the invisible-income-leg disclosure as data", () => {
    expect(qd.incomeLegVisible).toBe(false);
    const n = incomeNotices(qd);
    expect(n.map((x) => x.key)).toEqual(["invisible"]);
    expect(n[0].title).toBe("We can show you what this fund owns. We cannot show you what it sold.");
    expect(n[0].body).toContain("QDTE writes contracts that open and expire inside a single session");
    expect(qd.positionsSummary!.coveredPct).toBeNull();
    expect(noCoverageMessage(qd.incomeLegVisible)).toMatch(/intraday.*Coverage cannot be measured/);
    expect(noCoverageMessage(true)).toBe("No stock position to cover in the latest snapshot.");
  });
  it("MSTY (legs visible, no suppressed quote) has no notices", () => {
    expect(incomeNotices(msty)).toEqual([]);
    expect(incomeNotices(undefined)).toEqual([]);
  });
  it("a suppressed quote becomes a named warning", () => {
    const n = incomeNotices({ fund: "X", incomeLegVisible: true, positions: [{ ...msty.positions![0], ticker: "ABC", spotSuppressed: true }] });
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("Quote suppressed");
    expect(n[0].body).toContain("ABC");
    expect(n[0].body).toContain("more than 5%");
  });
  it("coverage class uses the filter's buckets", () => {
    expect([coverageClass(100), coverageClass(90), coverageClass(89.9), coverageClass(1), coverageClass(0), coverageClass(null)]).toEqual(["full", "full", "partial", "partial", "none", "none"]);
  });
});
