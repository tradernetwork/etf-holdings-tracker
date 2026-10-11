import dir from "./fixtures/income-directory.json";
import mstr from "./fixtures/ticker-mstr.json";
import tsla from "./fixtures/ticker-tsla.json";
import {
  ARCHETYPE_ORDER, dteSub, formatAum, groupByArchetype, INVISIBLE_INCOME_LEG, moneynessSub, moneynessTone, pct, signedPct, sortFunds,
  type IncomeDirectory,
} from "../lib/incomeDirectory";
import { buildOptionHolders, impliedSpot, legToLine, type TickerChangeRow, type TickerHoldingRow } from "../lib/optionHolders";

const d = dir as unknown as IncomeDirectory;

describe("income directory", () => {
  it("groups in website order and keeps every fund exactly once", () => {
    const s = groupByArchetype(d);
    const order = s.map((x) => x.key);
    expect(order).toEqual(ARCHETYPE_ORDER.filter((k) => order.includes(k)));
    expect(s.flatMap((x) => x.funds).length).toBe(d.fundCount);
    for (const sec of s) {
      expect(sec.label.length).toBeGreaterThan(0);
      expect(sec.summary.length).toBeGreaterThan(0);
    }
  });
  it("filters to one archetype", () => {
    const s = groupByArchetype(d, { archetype: "synthetic" });
    expect(s).toHaveLength(1);
    expect(s[0].funds.every((f) => f.archetype === "synthetic")).toBe(true);
  });
  it("sorts by AUM biggest-first and DTE shortest-first, missing values last", () => {
    const funds = d.funds;
    const aum = sortFunds(funds, "aum");
    expect((aum[0].aum ?? 0) >= (aum[1].aum ?? 0)).toBe(true);
    const dte = sortFunds(funds, "dte").map((f) => f.tiles.weightedDte);
    const firstNull = dte.findIndex((x) => x === null);
    if (firstNull >= 0) expect(dte.slice(firstNull).every((x) => x === null)).toBe(true);
    const known = dte.filter((x): x is number => x !== null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    expect(sortFunds(funds, "name")[0].fund <= sortFunds(funds, "name")[1].fund).toBe(true);
  });
  it("flags invisible income legs from the API", () => {
    const hidden = d.funds.filter((f) => !f.incomeLegVisible);
    expect(hidden.length).toBeGreaterThan(0);
    expect(INVISIBLE_INCOME_LEG).toMatch(/not visible in holdings data/);
  });
  it("formats like the website", () => {
    expect(pct(null)).toBe("—");
    expect(pct(12.345, 2)).toBe("12.35%");
    expect(signedPct(-7.49)).toBe("−7.5%");
    expect(signedPct(12.34)).toBe("+12.3%");
    expect(moneynessTone(2)).toBe("sell");
    expect(moneynessTone(-1)).toBe("income");
    expect(moneynessTone(-5)).toBe("buy");
    expect(moneynessTone(null)).toBe("muted");
    expect(moneynessSub(null)).toBe("no spot data");
    expect(dteSub(2)).toBe("daily cycle");
    expect(dteSub(7)).toBe("weekly cycle");
    expect(dteSub(30)).toBe("monthly+");
    expect(formatAum(1.132)).toBe("$1.13B");
    expect(formatAum(0.085)).toBe("$85M");
  });
});

const rows = (t: unknown) => (t as { holdings: TickerHoldingRow[]; changes: TickerChangeRow[] });

describe("ticker option holders", () => {
  const m = rows(mstr);
  const built = buildOptionHolders("MSTR", m.holdings, m.changes);
  it("lists funds with live legs, signed contracts and fund weight", () => {
    expect(built.funds.map((f) => f.fund)).toEqual(expect.arrayContaining(["MSTY", "MSTW"]));
    const msty = built.funds.find((f) => f.fund === "MSTY")!;
    expect(msty.legs.some((l) => l.short)).toBe(true);
    expect(msty.legs.some((l) => !l.short)).toBe(true);
    expect(msty.legs.some((l) => l.flex)).toBe(true);
    const sorted = msty.legs.map((l) => l.expiry ?? "");
    expect(sorted).toEqual([...sorted].sort());
    expect(built.legCount).toBe(built.funds.reduce((s, f) => s + f.legs.length, 0));
  });
  it("hides legs that expired before the file date", () => {
    const h = m.holdings.find((x) => x.isOption)!;
    const expired: TickerHoldingRow = { ...h, optionDetails: { ...h.optionDetails!, expiry: "2020-01-01" } };
    const r = buildOptionHolders("MSTR", [expired], []);
    expect(r.funds).toHaveLength(0);
    expect(r.expiredHidden).toBe(1);
  });
  it("implies a spot from equity holders and uses it for ITM/OTM", () => {
    const spot = impliedSpot(m.holdings);
    expect(spot).not.toBeNull();
    const chips = built.funds.flatMap((f) => f.legs).filter((l) => l.chip);
    expect(chips.length).toBeGreaterThan(0);
    for (const l of chips) expect(["ITM", "OTM", "ATM"]).toContain(l.chip!.label);
  });
  it("carries the contract change of a leg from the changes list", () => {
    const withDelta = built.funds.flatMap((f) => f.legs).filter((l) => l.contractsDelta !== null);
    expect(withDelta.length).toBeGreaterThan(0);
  });
  it("computes coverage only when the fund holds the shares and wrote calls", () => {
    const t = rows(tsla);
    const r = buildOptionHolders("TSLA", t.holdings, t.changes);
    for (const f of r.funds) {
      if (f.coveragePct !== null) {
        expect(f.sharesHeld).toBeGreaterThan(0);
        expect(f.legs.some((l) => l.short && l.type === "Call")).toBe(true);
      }
    }
  });
  it("labels stale disclosures", () => {
    const h = m.holdings.find((x) => x.isOption)!;
    const r = buildOptionHolders("MSTR", [{ ...h, stale: true, fileDate: "2026-09-25", optionDetails: { ...h.optionDetails!, expiry: "2026-12-18" } }], []);
    expect(r.funds[0].stale).toBe(true);
    expect(r.funds[0].fileDate).toBe("2026-09-25");
  });
  it("adapts an option-structure leg to the shared row", () => {
    const l = legToLine({ optionType: "PUT", strike: 135.01, expiry: "2026-11-20", contracts: -40450, isFlex: true, dte: 40, marketValue: -2e7, change: 0 }, "MSTR");
    expect(l).toMatchObject({ type: "Put", short: true, flex: true, dte: 40, contractsDelta: 0 });
  });
});
