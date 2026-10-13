import fund from "./fixtures/msty-fund.json";
import { deltaLabel, deltaSpan, snapshotSpan, weekdayDay } from "../lib/deltaPeriod";

describe("what period a delta covers", () => {
  it("names the weekday and date of the snapshot the delta is measured against", () => {
    expect(weekdayDay("2026-10-09")).toBe("Fri Oct 9");
    expect(weekdayDay("2026-10-12")).toBe("Mon Oct 12");
    expect(weekdayDay("2026-01-01")).toBe("Thu Jan 1");
    expect(weekdayDay(null)).toBe("");
    expect(weekdayDay("nope")).toBe("");
  });
  it("one trading day is just 'vs <date>'", () => {
    expect(deltaSpan({ previousDate: "2026-10-09", comparisonTradingDays: 1 })).toBe("vs Fri Oct 9");
    // a Monday file against Friday is one trading day, not three calendar days
    expect(deltaLabel("Δ shares", { previousDate: "2026-10-09", comparisonTradingDays: 1 })).toBe("Δ shares · vs Fri Oct 9");
  });
  it("says so when the gap is more than one trading day", () => {
    expect(deltaSpan({ previousDate: "2026-10-07", comparisonTradingDays: 3 })).toBe("vs Wed Oct 7 (3 trading days)");
    expect(deltaSpan({ previousDate: "2026-10-02", comparisonTradingDays: 6 })).toBe("vs Fri Oct 2 (6 trading days)");
  });
  it("keeps the catch-up wording: since the carried-forward date, not daily moves", () => {
    expect(deltaSpan({ catchUp: true, catchUpSince: "2026-09-25", previousDate: "2026-10-09", comparisonTradingDays: 1 })).toBe("since Sep 25, not daily moves");
    expect(deltaLabel("Δ shares", { catchUp: true, catchUpSince: "2026-09-25" })).toBe("Δ shares · since Sep 25, not daily moves");
    expect(deltaSpan({ catchUp: true, catchUpSince: null })).toBe("since an earlier file, not daily moves");
  });
  it("a stale fund has no new disclosure to compare", () => {
    expect(deltaSpan({ stale: true, holdingsDate: "2026-09-25", previousDate: "2026-10-09" })).toBe("no new disclosure since Sep 25");
  });
  it("is null on a server that does not say, so nothing is invented", () => {
    expect(deltaSpan({})).toBeNull();
    expect(deltaSpan({ previousDate: null, comparisonTradingDays: null })).toBeNull();
    expect(deltaLabel("Δ", {})).toBeNull();
  });
  it("Today's lists show only the plain snapshot span", () => {
    expect(snapshotSpan({ previousDate: "2026-10-09", comparisonTradingDays: 1 })).toBe("vs Fri Oct 9");
    expect(snapshotSpan({})).toBeNull();
  });
  it("reads the live fund payload", () => {
    const f = fund as unknown as { asOfDate: string; previousDate?: string; comparisonTradingDays?: number };
    if (f.previousDate) expect(deltaSpan(f)).toMatch(/^vs [A-Z][a-z]{2} [A-Z][a-z]{2} \d+/);
  });
});
