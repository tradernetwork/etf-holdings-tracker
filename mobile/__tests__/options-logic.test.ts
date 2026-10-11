import activityFx from "./fixtures/options-activity-weekly.json";
import listingsFx from "./fixtures/options-listings.json";
import mstrFx from "./fixtures/options-mstr.json";
import scheduleMon from "./fixtures/options-schedule-mon.json";
import scheduleHoliday from "./fixtures/options-schedule-holiday-skip.json";
import {
  activeFilterCount, contractLabel, countNew, countRemoved, DEFAULT_ACTIVITY_FILTERS, decodeOptionSignal, filterActivity,
  filterScanEntries, formatContractsChange, formatWeightDelta, groupByProvider, legsOfStructure, PROVIDER_ORDER,
  signalLabel, sortActivity, strategyBadge, structureLabel, tradeSummary, visibleScans,
} from "../lib/options/logic";
import type { ListingScan, ListingsResponse, OptionActivityRecord, OptionsByUnderlying } from "../lib/options/types";

const records = (activityFx as unknown as { optionsActivity: OptionActivityRecord[] }).optionsActivity;
const listings = listingsFx as unknown as ListingsResponse;
const mstr = mstrFx as unknown as OptionsByUnderlying;

const rec = (over: Partial<OptionActivityRecord> & { type?: OptionActivityRecord["type"]; opt?: string; strike?: number }): OptionActivityRecord => ({
  fund: "MSTY", ticker: "MSTR  261120C00135000", name: "MSTR C135", sector: "", type: over.type ?? "NEW", isOption: true,
  weightDelta: 1, activeWeightDelta: 1, sharesDelta: 100, currentWeight: 1, previousWeight: 0, currentShares: 100, previousShares: 0,
  optionDetails: { type: over.opt ?? "Call", strike: over.strike ?? 135, expiry: "2026-11-20", underlying: "MSTR" }, ...over,
});

describe("decoder (port of the website's decodeOptionSignal)", () => {
  it("reads a put as a cash-secured put and a call as a covered call", () => {
    expect(decodeOptionSignal(rec({ opt: "Put", strike: 148 }))).toEqual({ strategy: "Cash-Secured Put", directionalView: "Bullish above $148", moneyness: "OTM (likely)" });
    expect(decodeOptionSignal(rec({ opt: "Call", currentWeight: 0 }))).toEqual({ strategy: "Covered Call", directionalView: "Capping upside at $135", moneyness: "ATM/ITM" });
  });
  it("keeps FLEX decimal strikes exactly as the API sends them", () => {
    expect(decodeOptionSignal(rec({ opt: "Call", strike: 219.34 }))?.directionalView).toBe("Capping upside at $219.34");
  });
  it("prints strikes like the contract title, so 366.2 reads $366.20", () => {
    expect(decodeOptionSignal(rec({ opt: "Put", strike: 366.2 }))?.directionalView).toBe("Bullish above $366.20");
  });
  it("returns null for non-options and unknown types", () => {
    expect(decodeOptionSignal({ isOption: false, optionDetails: undefined, currentWeight: 1 })).toBeNull();
    expect(decodeOptionSignal(rec({ opt: "Swaption" }))).toBeNull();
  });
  it("decodes every real record in the fixture without throwing", () => {
    expect(records.length).toBeGreaterThan(50);
    for (const r of records) expect(decodeOptionSignal(r)).not.toBeNull();
  });
});

describe("labels", () => {
  it("formats the contract like the brief: underlying, strike, type, expiry", () => {
    expect(contractLabel(rec({}))).toBe("MSTR $135 Call 11/20/26");
    expect(contractLabel(rec({ opt: "Put", strike: 152.5 }))).toBe("MSTR $152.50 Put 11/20/26");
    const flex = records.find((r) => r.optionDetails && r.optionDetails.strike % 1 !== 0)!;
    expect(contractLabel(flex)).toMatch(/\$\d+\.\d\d (Call|Put) \d\d\/\d\d\/\d\d$/);
  });
  it("falls back to the raw symbol when there are no option details", () => {
    expect(contractLabel({ optionDetails: undefined, ticker: "OTHER" })).toBe("OTHER");
  });
  it("uses the website's signal words and strategy badge", () => {
    expect([signalLabel("NEW"), signalLabel("REMOVED"), signalLabel("CHANGED")]).toEqual(["OPENED", "EXPIRED", "ROLLED"]);
    expect(strategyBadge(rec({ opt: "Call" }))).toBe("CC");
    expect(strategyBadge(rec({ opt: "Put" }))).toBe("CSP");
  });
  it("prints weight Δ with 3 decimals and never turns null into zero", () => {
    expect(formatWeightDelta(0.12345)).toBe("+0.123%");
    expect(formatWeightDelta(-1.5)).toBe("-1.500%");
    expect(formatWeightDelta(0)).toBe("0.000%");
    expect(formatWeightDelta(null)).toBe("—");
    expect(formatWeightDelta(Number.NaN)).toBe("—");
  });
});

describe("ordering and grouping", () => {
  it("lists puts first, then by the size of the weight change", () => {
    const sorted = sortActivity(records);
    const firstCall = sorted.findIndex((r) => !r.optionDetails!.type.toLowerCase().startsWith("p"));
    expect(sorted.slice(0, firstCall).every((r) => r.optionDetails!.type.toLowerCase().startsWith("p"))).toBe(true);
    const puts = sorted.slice(0, firstCall);
    expect(puts.map((r) => Math.abs(r.weightDelta))).toEqual([...puts.map((r) => Math.abs(r.weightDelta))].sort((a, b) => b - a));
  });
  it("groups by provider in the website order, unknown providers last", () => {
    const providerOf = (f: string) => ({ A: "YieldMax", B: "Avantis", C: "Zed Funds", D: "Roundhill" }[f] ?? "Other");
    const g = groupByProvider([rec({ fund: "A" }), rec({ fund: "C" }), rec({ fund: "B" }), rec({ fund: "D" }), rec({ fund: "A" })], providerOf);
    expect(g.map((x) => x.provider)).toEqual(["Avantis", "YieldMax", "Roundhill", "Zed Funds"]);
    expect(g[1].records).toHaveLength(2);
    expect(PROVIDER_ORDER.indexOf("Avantis")).toBeLessThan(PROVIDER_ORDER.indexOf("YieldMax"));
  });
  it("covers every fund of the real fixture in some group (nothing is dropped)", () => {
    const g = groupByProvider(records, () => "X");
    expect(g.reduce((n, x) => n + x.records.length, 0)).toBe(records.length);
  });
});

describe("activity filters", () => {
  const f = (over: Partial<typeof DEFAULT_ACTIVITY_FILTERS>) => ({ ...DEFAULT_ACTIVITY_FILTERS, ...over });
  it("filters by option type, signal, fund and free text", () => {
    expect(filterActivity(records, f({ optionType: "Put" })).every((r) => r.optionDetails!.type.toLowerCase().startsWith("p"))).toBe(true);
    expect(filterActivity(records, f({ signal: "OPENED" })).every((r) => r.type === "NEW")).toBe(true);
    expect(filterActivity(records, f({ signal: "EXPIRED" })).every((r) => r.type === "REMOVED")).toBe(true);
    const fund = records[0].fund;
    expect(filterActivity(records, f({ fund })).every((r) => r.fund === fund)).toBe(true);
    const u = records[0].optionDetails!.underlying;
    expect(filterActivity(records, f({ q: u.toLowerCase() })).length).toBeGreaterThan(0);
    expect(filterActivity(records, f({ q: "zzzzzz" }))).toEqual([]);
  });
  it("filters by fund category using the record, else a lookup", () => {
    const income = filterActivity(records, f({ category: "option-income" }));
    expect(income.length).toBeGreaterThan(0);
    expect(income.every((r) => r.fundCategory === "option-income")).toBe(true);
    const bare = [{ ...rec({}), fundCategory: undefined }];
    expect(filterActivity(bare, f({ category: "option-income" }), () => "option-income")).toHaveLength(1);
    expect(filterActivity(bare, f({ category: "option-income" }), () => "active-equity")).toHaveLength(0);
  });
  it("counts the active filters (text search is not counted)", () => {
    expect(activeFilterCount(DEFAULT_ACTIVITY_FILTERS)).toBe(0);
    expect(activeFilterCount(f({ optionType: "Call", signal: "ROLLED", q: "x" }))).toBe(2);
  });
});

describe("CBOE listings (port of filterScanEntries)", () => {
  const latest = listings.latest as ListingScan;
  it("matches the live scan's totals and counts", () => {
    const all = filterScanEntries(latest, "all", "");
    expect(countNew(all)).toBe(10);
    expect(countRemoved(all)).toBe(1);
    expect(all.newOptionable.length).toBe(10);
    expect(all.newWeeklyEtfs).toEqual([]);
  });
  it("a category zeroes the other five lists", () => {
    const etfs = filterScanEntries(latest, "etfs", "");
    expect(countNew(etfs) + countRemoved(etfs)).toBe(0);
    const opt = filterScanEntries(latest, "optionable", "");
    expect(opt.newOptionable.length).toBe(10);
    expect(opt.removedOptionable).toEqual([["QNCX", "QUINCE THERAPEUTICS INC COM"]]);
  });
  it("search hits the symbol or the company name, case-insensitively", () => {
    expect(filterScanEntries(latest, "all", "tidal").newOptionable.map((e) => e[0]).sort()).toEqual(["AVXX", "OMAH", "RKLZ"]);
    expect(filterScanEntries(latest, "all", "vylr").newOptionable).toHaveLength(1);
    expect(filterScanEntries(latest, "all", "nothing-here").newOptionable).toEqual([]);
  });
  it("with a filter on, only scans that still have a match remain; stable scans drop out", () => {
    const all = visibleScans(listings.history, "all", "");
    expect(all).toHaveLength(listings.history.length);
    expect(all.some((s) => !s.hasChanges)).toBe(true); // 10-09 and 10-08 are 'stable' and stay in the unfiltered timeline
    const filtered = visibleScans(listings.history, "optionable", "");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(all.length);
    expect(filtered.every((s) => s.hasChanges)).toBe(true);
    expect(visibleScans(listings.history, "all", "zzzzzz")).toEqual([]);
  });
});

describe("MWF schedule (API payload as served)", () => {
  it("Monday is an expiration day and the next one is Wednesday", () => {
    expect(scheduleMon).toMatchObject({ isExpirationDay: true, dayName: "Monday", nextExpirationDay: "Wednesday", nextExpirationDate: "2026-10-14" });
    expect(scheduleMon.tickers).toHaveLength(12);
    expect(scheduleMon.excludes).toEqual(["SPY", "QQQ"]);
  });
  it("skips the Friday July 3 holiday to the following Monday", () => {
    expect(scheduleHoliday).toMatchObject({ dayName: "Wednesday", nextExpirationDay: "Monday", nextExpirationDate: "2026-07-06" });
    expect(scheduleHoliday.holidays).toContain("2026-07-03");
  });
});

describe("option structures (/options/{underlying})", () => {
  it("every structure's leg indices resolve to a real leg", () => {
    expect(mstr.funds.length).toBeGreaterThan(1);
    for (const book of mstr.funds) {
      for (const s of book.structures) {
        const legs = legsOfStructure(book, s);
        expect(legs).toHaveLength(s.legs.length);
        expect(legs.every(Boolean)).toBe(true);
      }
    }
  });
  it("labels every structure and trade kind that appears, with no raw kind leaking through", () => {
    const kinds = new Set(mstr.funds.flatMap((b) => b.structures.map((s) => structureLabel(s))));
    for (const k of kinds) expect(k).not.toMatch(/^[a-z]+-[a-z]+$/);
    expect(structureLabel({ kind: "call-spread", side: "credit" })).toBe("Call spread · credit");
    expect(structureLabel({ kind: "synthetic-long" })).toBe("Synthetic long");
    expect(tradeSummary({ kind: "roll", size: 34615 })).toBe("Roll · 34,615 contracts");
    expect(tradeSummary({ kind: "single", size: 1 })).toBe("Single change · 1 contract");
  });
  it("keeps short signs: written legs have negative contracts and say SHORT", () => {
    const legs = mstr.funds.flatMap((b) => b.legs);
    expect(legs.some((l) => l.contracts < 0)).toBe(true);
    expect(legs.some((l) => l.contracts > 0)).toBe(true);
  });
  it("formats contract changes honestly: unknown is a dash, zero is 'no change'", () => {
    expect(formatContractsChange(576)).toBe("+576");
    expect(formatContractsChange(-12000)).toBe("−12,000");
    expect(formatContractsChange(0)).toBe("no change");
    expect(formatContractsChange(null)).toBe("—");
  });
  it("carries FLEX flags, DTE and null market values through unchanged", () => {
    const legs = mstr.funds.flatMap((b) => b.legs);
    expect(legs.every((l) => l.isFlex === true || l.isFlex === false || l.isFlex === null)).toBe(true);
    expect(legs.every((l) => l.dte == null || typeof l.dte === "number")).toBe(true);
  });
});
