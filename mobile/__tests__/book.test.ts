import {
  activityLines, buildBook, daysBetween, dteLabel, formatExpiry, formatStrike, isExpired, moneynessChip,
  normalizeOptionType, optionExtrasOf, optionKey, optionSubtitle, optionTitle, rowsFromFundPayload, sideLabel,
  sleeveOf, sortGroups, sortLegs, sortStocks,
} from "../lib/book";
import type { FundResponse, HoldingsResponse } from "../lib/types";
import arkkFund from "./fixtures/arkk-fund.json";
import arkkHoldings from "./fixtures/arkk-holdings.json";
import avuvFund from "./fixtures/avuv-fund.json";
import avuvHoldings from "./fixtures/avuv-holdings.json";
import mstyFund from "./fixtures/msty-fund.json";
import mstyHoldings from "./fixtures/msty-holdings.json";

// Fixtures are captured from the live API (2026-10-09 snapshot): MSTY in full, AVUV/ARKK trimmed.
const msty = mstyHoldings as unknown as HoldingsResponse;
const mstyF = mstyFund as unknown as FundResponse;
const avuv = avuvHoldings as unknown as HoldingsResponse;
const avuvF = avuvFund as unknown as FundResponse;
const arkk = arkkHoldings as unknown as HoldingsResponse;
const arkkF = arkkFund as unknown as FundResponse;

describe("option label formatting", () => {
  it("titles a leg like a brokerage", () => {
    expect(optionTitle("MSTR", "CALL", 135)).toBe("MSTR $135 Call");
    expect(optionTitle("MSTR", "Put", 135.01)).toBe("MSTR $135.01 Put");
    expect(optionTitle("MSTR", "Call", 152.5)).toBe("MSTR $152.50 Call");
  });
  it("keeps FLEX decimal strikes", () => {
    expect(formatStrike(150.01)).toBe("$150.01");
    expect(formatStrike(150)).toBe("$150");
    expect(formatStrike(null)).toBe("—");
  });
  it("formats expiry, DTE and the FLEX marker", () => {
    expect(formatExpiry("2026-11-20")).toBe("11/20/26");
    expect(formatExpiry(null)).toBe("—");
    expect(dteLabel(42)).toBe("42 DTE");
    expect(dteLabel(1)).toBe("1 DTE");
    expect(dteLabel(0)).toBe("Expires today");
    expect(optionSubtitle("2026-11-20", 42, false)).toBe("11/20/26 · 42 DTE");
    expect(optionSubtitle("2026-12-18", 70, true)).toBe("12/18/26 · 70 DTE · FLEX");
  });
  it("labels long and short sides (negative contracts = written)", () => {
    expect(sideLabel(40450)).toBe("Long · 40,450 contracts");
    expect(sideLabel(-9400)).toBe("Short · 9,400 contracts");
    expect(sideLabel(1)).toBe("Long · 1 contract");
    expect(sideLabel(0)).toBe("");
    expect(sideLabel(null)).toBe("");
  });
  it("normalises option type casing from either payload", () => {
    expect(normalizeOptionType("CALL")).toBe("Call");
    expect(normalizeOptionType("Put")).toBe("Put");
    expect(normalizeOptionType(null)).toBe("");
  });
  it("computes ITM / OTM from underlying price and strike", () => {
    expect(moneynessChip("Call", 135, 154.66)).toEqual({ label: "ITM", underlyingPrice: 154.66 });
    expect(moneynessChip("Call", 165, 154.66)?.label).toBe("OTM");
    expect(moneynessChip("Put", 150.01, 154.66)?.label).toBe("OTM");
    expect(moneynessChip("Put", 160, 154.66)?.label).toBe("ITM");
    expect(moneynessChip("Call", 150, 150)?.label).toBe("ATM");
    expect(moneynessChip("Call", 150, null)).toBeNull();
  });
  it("dates: days between and expiry", () => {
    expect(daysBetween("2026-10-09", "2026-11-20")).toBe(42);
    expect(daysBetween("2026-10-09", "2026-10-09")).toBe(0);
    expect(isExpired("2026-10-09", "2026-10-09")).toBe(false); // expires today: still a position
    expect(isExpired("2026-10-09", "2026-10-12")).toBe(true);
    expect(isExpired(null, "2026-10-12")).toBe(false);
  });
});

describe("sleeves", () => {
  it("buckets MSTY's real rows", () => {
    const by = (name: string) => sleeveOf(msty.holdings.find((r) => r.name.startsWith(name))!);
    expect(by("United States Treasury Bill")).toBe("treasury");
    expect(by("United States Treasury Note")).toBe("treasury");
    expect(by("Cash & Other")).toBe("cash");
    expect(by("First American Government Obligations")).toBe("cash");
    expect(by("MSTR US 11/20/26 C135")).toBe("option");
  });
  it("does not mistake Pathward Financial (ticker CASH) for cash, even if the server classes it as cash", () => {
    // Pathward Financial's real ticker is CASH; the server has classed it "cash" (reported).
    const pathward = { isOption: false, ticker: "CASH", name: "PATHWARD FINANCIAL INC COMMON STOCK USD.01", assetClass: "cash" };
    expect(sleeveOf(pathward)).toBe("stock");
    expect(sleeveOf({ ...pathward, name: "Cash & Other", ticker: "Cash&Other" })).toBe("cash");
  });
  it("trusts the server's assetClass for non-equity rows, and still catches money-market funds it calls equity", () => {
    const fg = msty.holdings.find((r) => r.ticker === "FGXXX")!;
    // Captured before the server fix (money-market funds were classed "equity"); the guard still puts it in cash.
    expect(sleeveOf(fg)).toBe("cash");
    expect(sleeveOf({ isOption: false, name: "WEEKLYPAY SWAP", ticker: "X", assetClass: "swap" })).toBe("swap");
    expect(sleeveOf({ isOption: false, name: "Something", ticker: "Y", assetClass: "other" })).toBe("cash");
    expect(sleeveOf({ isOption: false, name: "ACME CORP COMMON STOCK", ticker: "ACME", assetClass: "equity" })).toBe("stock");
  });
  it("uses the row's own dte and active weight (API #156)", () => {
    const b = buildBook(msty.holdings, { asOfDate: msty.asOfDate });
    const leg = msty.holdings.find((r) => r.isOption && r.dte === 70)!;
    expect(b.optionGroups[0].lines.find((l) => l.key === `o:${leg.ticker}`)!.dte).toBe(70);
    const stockRow = avuv.holdings.find((r) => r.assetClass === "equity" && r.activeWeightDelta != null)!;
    const sb = buildBook([stockRow], { asOfDate: avuv.asOfDate });
    expect(sb.stocks[0].activeDelta).toBe(stockRow.activeWeightDelta);
  });
});

describe("MSTY: an option fund with NO stocks", () => {
  const book = buildBook(msty.holdings, { asOfDate: msty.asOfDate, optionExtras: optionExtrasOf(mstyF) });

  it("splits into options + Treasuries + cash and no stocks", () => {
    expect(book.stocks).toEqual([]);
    expect(book.optionGroups).toHaveLength(1);
    expect(book.optionGroups[0].underlying).toBe("MSTR");
    expect(book.optionGroups[0].lines).toHaveLength(16);
    expect(book.buckets.map((b) => b.sleeve)).toEqual(["treasury", "cash"]);
    expect(book.buckets[0].lines).toHaveLength(5);
    expect(book.buckets[1].lines).toHaveLength(2);
  });
  it("allocation matches the Income screen's sleeves (and adds up to the whole fund)", () => {
    const w = Object.fromEntries(book.allocation.map((s) => [s.key, s.weight]));
    expect(w.optionsLong).toBeCloseTo(14.574, 1);
    expect(w.optionsShort).toBeCloseTo(-7.817, 1);
    expect(w.treasury).toBeCloseTo(59.973, 1);
    expect(w.cash).toBeCloseTo(33.27, 1);
    expect(book.allocation.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(100, 1);
  });
  it("marks written legs short (negative contracts) and keeps FLEX decimals", () => {
    const legs = book.optionGroups[0].lines;
    const shorts = legs.filter((l) => l.short);
    expect(shorts.length).toBe(msty.holdings.filter((r) => r.isOption && (r.contracts ?? 0) < 0).length);
    expect(shorts.every((l) => l.contracts < 0 && l.value.usd! < 0)).toBe(true);
    const flex = legs.find((l) => l.flex && l.type === "Call")!;
    expect(flex.strike).toBe(150.01);
    expect(optionTitle(flex.underlying, flex.type, flex.strike)).toBe("MSTR $150.01 Call");
  });
  it("joins dte and the underlying price from the fund payload, and flags ITM/OTM", () => {
    const c135 = book.optionGroups[0].lines.find((l) => l.strike === 135 && l.type === "Call")!;
    expect(c135.dte).toBe(42);
    expect(c135.chip).toEqual({ label: "ITM", underlyingPrice: expect.closeTo(154.66, 1) });
    expect(optionKey("MSTR", "CALL", 135, "2026-11-20")).toBe(optionKey("MSTR", "Call", 135.0, "2026-11-20"));
  });
  it("reported market value is not an estimate", () => {
    expect(book.optionGroups[0].lines.every((l) => l.value.estimated === false)).toBe(true);
  });
  it("sorts legs by expiry then strike (the chain), and groups by subtotal", () => {
    const chain = sortLegs(book.optionGroups[0].lines, "expiry");
    for (let i = 1; i < chain.length; i++) {
      const [p, q] = [chain[i - 1], chain[i]];
      const ordered = p.expiry! < q.expiry! || (p.expiry === q.expiry && (p.strike! < q.strike! || (p.strike === q.strike && p.type <= q.type)));
      expect(ordered).toBe(true); // expiry ascending, then strike ascending (numerically), then Call before Put
    }
    const byValue = sortLegs(book.optionGroups[0].lines, "value");
    expect(Math.abs(byValue[0].value.usd!)).toBeGreaterThanOrEqual(Math.abs(byValue[1].value.usd!));
    expect(sortGroups(book.optionGroups, "value")).toHaveLength(1);
  });
  it("subtotals are signed sums (written legs subtract)", () => {
    const g = book.optionGroups[0];
    expect(g.valueUsd).toBeCloseTo(g.lines.reduce((a, l) => a + l.value.usd!, 0), 0);
    expect(g.weight).toBeCloseTo(14.574 - 7.817, 1);
  });
  it("hides expired legs when the snapshot is past their expiry", () => {
    const later = buildBook(msty.holdings, { asOfDate: "2026-10-10", optionExtras: optionExtrasOf(mstyF) });
    const expiring = msty.holdings.filter((r) => r.expiry === "2026-10-09").length;
    expect(expiring).toBeGreaterThan(0);
    expect(later.expiredHidden).toBe(expiring);
    expect(later.optionGroups[0].lines).toHaveLength(16 - expiring);
    expect(later.optionGroups[0].lines.every((l) => l.expiry! >= "2026-10-10")).toBe(true);
  });
  it("describes recent option activity", () => {
    expect(activityLines(mstyF)).toEqual([expect.stringMatching(/^Rolled MSTR calls: closed 5, opened \d+$/)]);
  });
});

describe("AVUV: an equity fund", () => {
  const changes = new Map(avuvF.recentChanges.filter((c) => !c.isOption).map((c) => [c.ticker, c.activeWeightDelta]));
  const book = buildBook(avuv.holdings, { asOfDate: avuv.asOfDate, activeDeltaByTicker: changes });

  it("is stocks plus a money-market cash line, no options", () => {
    const cash = avuv.holdings.filter((r) => r.assetClass === "cash").length;
    expect(cash).toBeGreaterThan(0);
    expect(book.stocks.length).toBe(avuv.holdings.length - cash);
    expect(book.optionGroups).toEqual([]);
    expect(book.buckets.map((b) => b.sleeve)).toEqual(["cash"]);
    expect(book.allocation.map((s) => s.key)).toEqual(expect.arrayContaining(["stocks", "cash"]));
  });
  it("cleans names and carries shares, value, % and deltas", () => {
    const matx = book.stocks.find((s) => s.ticker === "MATX")!;
    expect(matx.name).toBe("Matson Inc");
    expect(matx.shares).toBe(1441915);
    expect(matx.value).toEqual({ usd: 328453817.85, estimated: false });
    expect(matx.sharesDelta).toBe(-888);
    expect(matx.activeDelta).toBe(-0.0054);
  });
  it("sorts by value, weight and today's change (nulls last)", () => {
    const byValue = sortStocks(book.stocks, "value");
    expect(byValue[0].value.usd!).toBeGreaterThanOrEqual(byValue[1].value.usd!);
    const byChange = sortStocks(book.stocks, "change");
    const firstNull = byChange.findIndex((s) => s.activeDelta === null);
    if (firstNull >= 0) expect(byChange.slice(firstNull).every((s) => s.activeDelta === null)).toBe(true);
    expect(sortStocks(book.stocks, "weight")[0].weight).toBeGreaterThanOrEqual(sortStocks(book.stocks, "weight")[1].weight);
  });
});

describe("ARKK: stale fund and the fallback path", () => {
  it("builds from the (trimmed) full book", () => {
    const book = buildBook(arkk.holdings, { asOfDate: arkk.asOfDate });
    expect(book.stocks.length).toBe(10);
    // The row's own active weight (API #156) is used; a stale fund's screen nulls it before building (see the screen).
    expect(book.stocks.every((s) => s.activeDelta === null || typeof s.activeDelta === "number")).toBe(true);
  });
  it("rebuilds a partial book from the fund payload when the server can't filter: top stocks + all option legs", () => {
    const rows = rowsFromFundPayload(mstyF);
    const b = buildBook(rows, { asOfDate: mstyF.asOfDate, optionExtras: optionExtrasOf(mstyF) });
    expect(b.stocks).toEqual([]);
    expect(b.optionGroups[0].lines).toHaveLength(16);
    expect(b.buckets).toEqual([]); // honest: no cash/Treasuries in the fallback
    const ak = rowsFromFundPayload(arkkF);
    expect(ak.length).toBe(arkkF.topHoldings.length);
  });
});

describe("catch-up funds (null deltas) never throw", () => {
  it("passes null deltas through as unknown", () => {
    const rows = avuv.holdings.slice(0, 3).map((r) => ({ ...r, weightDelta: null, activeWeightDelta: null, sharesDelta: null, catchUpSince: "2026-09-25" }));
    const book = buildBook(rows, { asOfDate: "2026-10-12" });
    expect(book.stocks.every((s) => s.sharesDelta === null && s.activeDelta === null)).toBe(true);
    expect(() => sortStocks(book.stocks, "change")).not.toThrow();
  });
});
