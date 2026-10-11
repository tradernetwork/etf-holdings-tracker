import fundMsty from "./fixtures/msty-fund.json";
import msty from "./fixtures/income-detail-MSTY.json";
import kqqq from "./fixtures/income-detail-KQQQ.json";
import qdte from "./fixtures/income-detail-QDTE.json";
import statsFx from "./fixtures/stats.json";
import mstr from "./fixtures/ticker-mstr.json";
import { optionSubtitle } from "../lib/book";
import { dteToday, expiryInfo, expirySubtitle, shortDay, todayIso } from "../lib/expiry";
import { bookRowView, bookRowView as view, detailTiles, hasIncomeDetail, notionalLine, sleeveBar, type IncomeDetail } from "../lib/incomeDetail";
import { netAssetsLabel } from "../lib/incomeDetail";
import { legMeta } from "../lib/incomeBook";
import { apiUnderlyingPrice, buildOptionHolders, type TickerChangeRow, type TickerHoldingRow } from "../lib/optionHolders";
import { formatPutCall } from "../lib/stats";

// Sunday Oct 11 2026, local noon: two days after the Oct 9 snapshot.
const NOW = new Date(2026, 9, 11, 12, 0, 0);

describe("honest expiry labels", () => {
  it("counts from the device date, not the snapshot", () => {
    expect(todayIso(NOW)).toBe("2026-10-11");
    // Expires on the Oct 9 file date: already gone by Oct 11.
    const gone = expiryInfo({ expiry: "2026-10-09", asOf: "2026-10-09", fileDte: 0, now: NOW });
    expect(gone).toMatchObject({ label: "Expired Oct 9", expired: true, daysLeft: -2 });
    expect(gone.fileNote).toBe("File: 0 DTE as of Oct 9");
  });
  it("says Expires today on the day, and counts live legs", () => {
    expect(expiryInfo({ expiry: "2026-10-11", asOf: "2026-10-09", fileDte: 2, now: NOW }).label).toBe("Expires today");
    const live = expiryInfo({ expiry: "2026-10-16", asOf: "2026-10-09", fileDte: 7, now: NOW });
    expect(live).toMatchObject({ label: "5 DTE", expired: false, daysLeft: 5 });
    expect(live.fileNote).toBe("File: 7 DTE as of Oct 9");
  });
  it("adds no file note when the snapshot is today or the numbers agree", () => {
    expect(expiryInfo({ expiry: "2026-10-16", asOf: "2026-10-11", fileDte: 5, now: NOW }).fileNote).toBeNull();
    expect(expiryInfo({ expiry: "2026-10-16", asOf: "2026-10-11", fileDte: 5, now: NOW }).label).toBe("5 DTE");
  });
  it("falls back to the file's own DTE, labelled, when there is no expiry date", () => {
    expect(expiryInfo({ expiry: null, asOf: "2026-10-09", fileDte: 3, now: NOW }).label).toBe("3 DTE (as of Oct 9 file)");
    expect(expiryInfo({ expiry: null, now: NOW }).label).toBe("");
  });
  it("builds subtitles without repeating the date on an expired leg", () => {
    const e = expiryInfo({ expiry: "2026-10-09", asOf: "2026-10-09", fileDte: 0, now: NOW });
    expect(expirySubtitle(e, "2026-10-09", false)).toBe("Expired Oct 9");
    const live = expiryInfo({ expiry: "2026-11-20", asOf: "2026-10-09", fileDte: 42, now: NOW });
    expect(expirySubtitle(live, "2026-11-20", true)).toBe("11/20/26 · 40 DTE · FLEX");
    expect(optionSubtitle("2026-11-20", 42, true, "2026-10-09", NOW)).toBe("11/20/26 · 40 DTE · FLEX");
    // Without a snapshot date the old file-relative wording is unchanged.
    expect(optionSubtitle("2026-11-20", 42, false)).toBe("11/20/26 · 42 DTE");
  });
  it("shifts a file DTE to today", () => {
    expect(dteToday(7, "2026-10-09", NOW)).toBe(5);
    expect(dteToday(1, "2026-10-09", NOW)).toBeNull();
    expect(dteToday(7, null, NOW)).toBe(7);
    expect(shortDay("2026-10-09")).toBe("Oct 9");
  });
  it("labels income legs the same way", () => {
    const leg = { role: "written-call", optionType: "Call", strike: 160, expiry: "2026-10-09", dte: 0, expired: false, contracts: -1, price: null, marketValue: null, weight: 0, upsideRoomPct: 3.45 } as never;
    expect(legMeta(leg, undefined, "2026-10-09", NOW)).toMatch(/^Expired Oct 9 · File: 0 DTE as of Oct 9 · 3.5% upside room$/);
  });
});

describe("ITM/OTM spot", () => {
  const holdings = (mstr as unknown as { holdings: TickerHoldingRow[] }).holdings;
  const changes = (mstr as unknown as { changes: TickerChangeRow[] }).changes;
  it("reads the API's underlyingPrice from /fund optionHoldings", () => {
    const px = apiUnderlyingPrice("MSTR", (fundMsty as unknown as { optionHoldings: { underlying: string; underlyingPrice: number }[] }).optionHoldings);
    expect(px).toBeGreaterThan(100);
    expect(apiUnderlyingPrice("ZZZ", [])).toBeNull();
  });
  it("prefers the API price and reports its source, falling back to implied", () => {
    const api = buildOptionHolders("MSTR", holdings, changes, 154.66);
    expect(api.spot).toBe(154.66);
    expect(api.spotSource).toBe("api");
    const implied = buildOptionHolders("MSTR", holdings, changes, null);
    expect(implied.spotSource).toBe("implied");
    expect(implied.spot).not.toBe(154.66);
    expect(buildOptionHolders("MSTR", holdings.filter((h) => h.isOption), changes, null).spotSource).toBeNull();
  });
});

describe("income detail (/income/{fund})", () => {
  const d = msty as unknown as IncomeDetail;
  it("is recognised only when tiles and book are present", () => {
    expect(hasIncomeDetail(d)).toBe(true);
    expect(hasIncomeDetail({ ...d, tiles: undefined } as never)).toBe(false);
    expect(hasIncomeDetail(undefined)).toBe(false);
  });
  it("renders the six tiles in website order with its tones", () => {
    const t = detailTiles(d.tiles);
    expect(t.map((x) => x.label)).toEqual(["Call coverage", "Wtd moneyness", "Wtd DTE", "Upside room", "Capped", "Collateral"]);
    expect(t[0].value).toBe("—"); // MSTY holds no shares
    expect(t[1].value).toBe("-0.34%");
    expect(t[1].tone).toBe("buy");
    expect(t[1].sub).toBe("written out of the money");
    expect(t[4].value).toBe(`${d.tiles.cappedNames}/${d.tiles.namesWithWrittenCalls}`);
    expect(t[5].sub).toBe("cash + Treasuries");
    expect(detailTiles({ ...d.tiles, weightedMoneynessPct: 2 })[1].tone).toBe("sell");
    expect(detailTiles({ ...d.tiles, weightedMoneynessPct: null })[1].sub).toBe("no spot price available");
  });
  it("draws written options on their own bar", () => {
    const bar = sleeveBar(d.sleeves);
    expect(bar.short).not.toBeNull();
    expect(bar.short!.value).toBeLessThan(0);
    expect(bar.positive.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 5);
    expect(bar.positive.every((s) => s.value > 0)).toBe(true);
    expect(sleeveBar({ equity: 100, treasury: 0, cash: -2, swap: 0, optionsLong: 0, optionsShort: 0 })).toMatchObject({ short: null });
    expect(notionalLine(d.tiles)).toMatch(/^Notional written: calls .*% of NAV · puts .*% of NAV$/);
  });
  it("collapses the book to one row per underlying, DTE counted from today", () => {
    const row = bookRowView(d.book[0], d.asOfDate, NOW);
    expect(row.underlying).toBe("MSTR");
    expect(row.nav).toBe("no shares");
    expect(row.spot).toBe("154.66");
    expect(row.strike).toBe("160.00");
    expect(row.dte).toBe("exp"); // the Oct 9 written call has expired by Oct 11
    expect(row.dteNote).toBe("File: 0d as of Oct 9");
    expect(row.room).toBe("+3.5%");
    expect(row.roomTone).toBe("buy");
    expect(row.longLegs.startsWith("C150.01")).toBe(true);
    expect(row.legCount).toBe(d.book[0].legCount);
  });
  it("shows coverage, shares and the suppressed-spot warning", () => {
    const k = kqqq as unknown as IncomeDetail;
    const eq = k.book.find((r) => r.equity)!;
    const v = view(eq, k.asOfDate, NOW);
    expect(v.nav).toMatch(/%$/);
    expect(v.covered).toMatch(/%$/);
    const sup = view({ ...eq, spotSuppressed: true }, k.asOfDate, NOW);
    expect(sup.spot).toBe("⚠");
    expect(sup.spotSuppressed).toBe(true);
  });
  it("handles a fund whose income leg is invisible", () => {
    const q = qdte as unknown as IncomeDetail;
    expect(q.incomeLegVisible).toBe(false);
    expect(hasIncomeDetail(q)).toBe(true);
  });
});

it("prints net assets in M or B", () => {
  expect(netAssetsLabel({ netAssets: 85_000_000 })).toBe(" · $85.0M net assets");
  expect(netAssetsLabel({ netAssets: 1_132_472_040 })).toBe(" · $1.13B net assets");
  expect(netAssetsLabel({ netAssets: null })).toBe("");
});

describe("put/call ratio", () => {
  it("formats to two decimals like the website, and hides a missing value", () => {
    expect(formatPutCall((statsFx as { putCallRatio: number }).putCallRatio)).toMatch(/^\d+\.\d{2}$/);
    expect(formatPutCall(0.6)).toBe("0.60");
    expect(formatPutCall(undefined)).toBeNull();
    expect(formatPutCall(NaN)).toBeNull();
  });
});
