import layeringFx from "./fixtures/layering-full.json";
import todayFx from "./fixtures/today-full.json";
import todayLimitFx from "./fixtures/today-full-limit200.json";
import {
  allSectorFlow, businessDaysBehind, convText, coverageText, FULL_LIMIT, listState, PAGE_STEP, fundPositionUsd, isStaleAsOf, kpis, signalStreak, signalSummary, staleMessage,
  streakLabel, strengthText,
} from "../lib/today/logic";
import type { LayeringFull, TodayFull } from "../lib/today/types";

const today = todayFx as unknown as TodayFull;
const layering = layeringFx as unknown as LayeringFull;
const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

describe("stale warning (website businessDaysBehind)", () => {
  it("counts weekdays between the data date and now", () => {
    expect(businessDaysBehind("2026-10-09", at("2026-10-09"))).toBe(0);
    expect(businessDaysBehind("2026-10-09", at("2026-10-12"))).toBe(1); // Fri data on Monday: normal
    expect(businessDaysBehind("2026-10-09", at("2026-10-14"))).toBe(3);
    expect(businessDaysBehind("2026-10-09", at("2026-10-10"))).toBe(0); // Saturday adds no business day
    expect(businessDaysBehind(null)).toBe(0);
  });
  it("warns only past one business day, with the website's wording", () => {
    expect(isStaleAsOf("2026-10-09", at("2026-10-12"))).toBe(false);
    expect(isStaleAsOf("2026-10-09", at("2026-10-13"))).toBe(true);
    expect(staleMessage("2026-10-09", at("2026-10-13"))).toBe("Data is 2 business days stale. The scraper or the box sync may be delayed.");
    expect(staleMessage("2026-10-09", at("2026-10-12"))).toBeNull();
  });
});

describe("KPIs (website KPI bar, live payload)", () => {
  const items = kpis(today.stats);
  it("has funds, stocks, put/call, options, new and exits with the API's numbers", () => {
    expect(items.map((k) => k.key)).toEqual(["funds", "stocks", "pc", "opts", "new", "exits"]);
    const by = Object.fromEntries(items.map((k) => [k.key, k.value]));
    expect(by.funds).toBe(today.stats.fundsTracked.toLocaleString("en-US"));
    expect(by.stocks).toBe(today.stats.uniqueTickers.toLocaleString("en-US"));
    expect(by.pc).toBe(String(today.stats.putCallRatio));
    expect(by.new).toBe(String(today.stats.newPositionsToday));
    expect(items.every((k) => k.blurb.length > 20)).toBe(true);
  });
  it("omits New/Exits when the API doesn't send them, and nothing at all with no stats", () => {
    const s = { ...today.stats } as Partial<typeof today.stats>;
    delete s.newPositionsToday; delete s.exitsToday;
    expect(kpis(s as typeof today.stats).map((k) => k.key)).toEqual(["funds", "stocks", "pc", "opts"]);
    expect(kpis(undefined)).toEqual([]);
  });
});

describe("full lists (nothing capped client-side)", () => {
  it("keeps every signal the API serves, with the numeric conviction and per-fund detail", () => {
    expect(today.signals.buying.length).toBeGreaterThan(0);
    for (const s of [...today.signals.buying, ...today.signals.selling]) {
      expect(typeof s.convictionScore).toBe("number");
      expect(s.fundDetails.length).toBe(s.fundCount);
      expect(s.providers.length).toBe(s.providerCount);
      expect(convText(s.convictionScore)).toMatch(/^conv -?\d+\.\d$/);
    }
  });
  it("lists every sector, inflows and outflows together, biggest move first", () => {
    const flow = allSectorFlow(today.sectorFlow);
    expect(flow).toHaveLength(today.sectorFlow.inflows.length + today.sectorFlow.outflows.length);
    const mags = flow.map((f) => Math.abs(f.delta));
    expect(mags).toEqual([...mags].sort((a, b) => b - a));
    expect(allSectorFlow(undefined)).toEqual([]);
  });
  it("carries the briefing lists, divergences and streaks through unchanged", () => {
    expect(today.briefing.activeStreaks.length).toBeGreaterThan(0);
    const st = today.briefing.activeStreaks[0];
    expect(streakLabel(st.days, st.direction)).toMatch(/^\d+d [↑↓]$/);
    for (const d of today.divergences) {
      expect(d.buyingFunds.length).toBe(d.buying.length);
      expect(d.sellingFunds.length).toBe(d.selling.length);
      expect(typeof d.intrashop).toBe("boolean");
      expect(typeof d.crossCategory).toBe("boolean");
    }
  });
});

describe("signal text", () => {
  it("summarises a signal in active-weight points", () => {
    expect(signalSummary({ totalWeightDelta: 1.0783, fundCount: 2, providerCount: 2 })).toBe("+1.08 pp across 2 funds from 2 providers");
    expect(signalSummary({ totalWeightDelta: -0.8787, fundCount: 1, providerCount: 1 })).toBe("−0.88 pp across 1 fund from 1 provider");
  });
  it("shows a streak only when there is one", () => {
    expect(signalStreak({ streak: null })).toBeNull();
    expect(signalStreak({ streak: 0 })).toBeNull();
    expect(signalStreak({ streak: -4 })).toBe("4-day streak");
  });
  it("sizes a fund's position from the API's AUM, null when AUM is unknown (never zero)", () => {
    expect(fundPositionUsd({ currentWeight: 2, aumUsd: 1_000_000_000, aum: 1 })).toBe(20_000_000);
    expect(fundPositionUsd({ currentWeight: 2, aumUsd: null, aum: 0.5 })).toBe(10_000_000);
    expect(fundPositionUsd({ currentWeight: 2, aumUsd: null, aum: null })).toBeNull();
  });
});

describe("layering (live /layering-patterns, min_funds=2)", () => {
  it("returns every pattern asked for, each with a strength and a first-to-last sequence", () => {
    expect(layering.patterns.length).toBe(Math.min(layering.total, 100));
    for (const p of layering.patterns) {
      expect(p.layeringStrength).toBeGreaterThanOrEqual(0);
      expect(p.layeringStrength).toBeLessThanOrEqual(100);
      expect(strengthText(p.layeringStrength)).toMatch(/^\d{1,3}$/);
      expect(p.entrySequence.length).toBe(p.distinctFunds);
      const days = p.entrySequence.map((e) => e.daysIntoLayering);
      expect(days).toEqual([...days].sort((a, b) => a - b));
      expect(days[0]).toBe(0);
    }
  });
  it("keeps combined AUM and the estimated position as different quantities", () => {
    const p = layering.patterns.find((x) => x.positionUsdTotal != null)!;
    expect(p.consensusAum * 1e9).toBeGreaterThan(p.positionUsdTotal!);
  });
});

describe("?limit= and the Show more step", () => {
  const ext = todayLimitFx as unknown as TodayFull;
  it("a server that honours the limit echoes it and sends the longer lists (live data shape)", () => {
    expect(ext.limit).toBe(FULL_LIMIT);
    expect(ext.signals.buying.length).toBeGreaterThan(today.signals.buying.length);
    // the first ten are exactly the default top ten, in the same order
    expect(ext.signals.buying.slice(0, 10).map((s) => s.ticker)).toEqual(today.signals.buying.map((s) => s.ticker));
    expect(ext.briefing.activeStreaks.length).toBeGreaterThan(today.briefing.activeStreaks.length);
    expect(ext.briefing.topBuys.length).toBe(ext.signals.buying.length);
  });
  it("an older server sends no echo and a fixed top list: never claimed as complete", () => {
    expect(today.limit).toBeUndefined();
    const st = listState(today.signals.buying.length, PAGE_STEP, FULL_LIMIT, today.limit);
    expect(st.coverage).toBe("fixed");
    expect(coverageText("buying signals", st, FULL_LIMIT)).toMatch(/fixed top list/);
    expect(coverageText("buying signals", st, FULL_LIMIT)).not.toMatch(/complete/);
  });
  it("says complete only when the limit was echoed and the list is shorter than the limit", () => {
    const whole = listState(ext.signals.buying.length, PAGE_STEP, FULL_LIMIT, ext.limit);
    expect(whole.coverage).toBe("complete");
    expect(coverageText("buying signals", whole, FULL_LIMIT)).toMatch(/complete ranked list/);
    const capped = listState(FULL_LIMIT, PAGE_STEP, FULL_LIMIT, FULL_LIMIT);
    expect(capped.coverage).toBe("capped");
    expect(coverageText("buying signals", capped, FULL_LIMIT)).toMatch(/200-row cap/);
    // an echo of a DIFFERENT limit is not our request being honoured
    expect(listState(50, PAGE_STEP, FULL_LIMIT, 10).coverage).toBe("fixed");
  });
  it("reveals PAGE_STEP rows at a time and counts what is hidden", () => {
    let st = listState(77, PAGE_STEP, FULL_LIMIT, FULL_LIMIT);
    expect([st.visible, st.hidden, st.nextStep]).toEqual([25, 52, 25]);
    st = listState(77, 75, FULL_LIMIT, FULL_LIMIT);
    expect([st.visible, st.hidden, st.nextStep]).toEqual([75, 2, 2]);
    st = listState(77, 100, FULL_LIMIT, FULL_LIMIT);
    expect([st.visible, st.hidden, st.nextStep]).toEqual([77, 0, 0]);
    expect(listState(0, PAGE_STEP, FULL_LIMIT, FULL_LIMIT).visible).toBe(0);
  });
});
