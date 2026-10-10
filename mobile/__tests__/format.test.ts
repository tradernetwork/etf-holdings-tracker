import {
  cleanName,
  formatPp,
  formatShares,
  formatShortDate,
  formatUsd,
  formatUsdValue,
  freshnessLabel,
  fundAumUsd,
  resolveUsd,
  sectorLabel,
  sectorShort,
} from "../lib/format";

describe("formatPp", () => {
  it("formats percentage points with a typographic minus", () => {
    expect(formatPp(-0.0104)).toBe("−0.01 pp");
    expect(formatPp(0.5959)).toBe("+0.60 pp");
    expect(formatPp(1.0783)).toBe("+1.08 pp");
  });
  it("handles zero, tiny and missing values", () => {
    expect(formatPp(0)).toBe("0.00 pp");
    expect(formatPp(0.001)).toBe("+<0.01 pp");
    expect(formatPp(-0.001)).toBe("−<0.01 pp");
    expect(formatPp(null)).toBe("—");
    expect(formatPp(undefined)).toBe("—");
  });
  it("can omit the plus sign", () => {
    expect(formatPp(0.5959, { sign: false })).toBe("0.60 pp");
  });
});

describe("formatUsd", () => {
  it("compacts magnitudes", () => {
    expect(formatUsd(1.2e9)).toBe("$1.20B");
    expect(formatUsd(48.888e9)).toBe("$48.9B");
    expect(formatUsd(340e6)).toBe("$340M");
    expect(formatUsd(12_300)).toBe("$12.3K");
    expect(formatUsd(950)).toBe("$950");
  });
  it("keeps the sign and handles null", () => {
    expect(formatUsd(-2.5e6)).toBe("−$2.50M");
    expect(formatUsd(null)).toBe("—");
  });
});

describe("resolveUsd / formatUsdValue", () => {
  it("prefers the API's explicit dollars", () => {
    const v = resolveUsd({ apiUsd: 5_000_000, weightPercent: 1, aumBillions: 10 });
    expect(v).toEqual({ usd: 5_000_000, estimated: false });
    expect(formatUsdValue(v)).toBe("$5.00M");
  });
  it("falls back to weight x AUM (billions) and labels it an estimate", () => {
    const v = resolveUsd({ apiUsd: null, weightPercent: 1.5, aumBillions: 8.76 });
    expect(v.estimated).toBe(true);
    expect(v.usd).toBeCloseTo(0.015 * 8.76e9, 0);
    expect(formatUsdValue(v)).toBe("est. $131M");
  });
  it("treats an explicit zero as real, not missing", () => {
    expect(resolveUsd({ apiUsd: 0, weightPercent: 5, aumBillions: 1 })).toEqual({ usd: 0, estimated: false });
  });
  it("returns null when nothing is known", () => {
    expect(resolveUsd({})).toEqual({ usd: null, estimated: false });
    expect(formatUsdValue({ usd: null, estimated: false })).toBe("—");
  });
});

describe("fundAumUsd", () => {
  it("prefers aumUsd, else converts billions", () => {
    expect(fundAumUsd({ aum: 8.76, aumUsd: 8_760_000_000 })).toBe(8_760_000_000);
    expect(fundAumUsd({ aum: 8.76 })).toBeCloseTo(8.76e9, 0);
    expect(fundAumUsd({})).toBeNull();
  });
});

describe("cleanName", () => {
  const cases: [string, string][] = [
    ["APPLE INC COMMON STOCK USD.00001", "Apple Inc"],
    ["META PLATFORMS INC CLASS A COMMON STOCK USD.000006", "Meta Platforms Inc"],
    ["DEERE + CO COMMON STOCK USD1.0", "Deere & Co"],
    ["NEWMONT CORP COMMON STOCK USD1.6", "Newmont Corp"],
    ["SAP SE COMMON STOCK", "SAP SE"],
    ["VOPAK COMMON STOCK EUR.5", "Vopak"],
    ["Micron Technology Inc", "Micron Technology Inc"],
    ["BERKSHIRE HATHAWAY INC CL B", "Berkshire Hathaway Inc"],
    ["TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD SPONSORED ADR", "Taiwan Semiconductor Manufacturing Co Ltd"],
    ["SOMEBANK ORD SHS", "Somebank"],
    ["BANK OF AMERICA CORP", "Bank of America Corp"],
    ["Nutanix Inc A", "Nutanix Inc"],
    ["Coinbase Global Inc -class A", "Coinbase Global Inc"],
    ["Robinhood Markets Inc - A", "Robinhood Markets Inc"],
    ["Shopify Inc -", "Shopify Inc"],
    ["Tempus AI Inc-cl A", "Tempus AI Inc"],
  ];
  it.each(cases)("%s -> %s", (raw, expected) => {
    expect(cleanName(raw)).toBe(expected);
  });
  it("handles empty input and never returns an empty string for a non-empty name", () => {
    expect(cleanName("")).toBe("");
    expect(cleanName(null)).toBe("");
    expect(cleanName("COMMON STOCK")).not.toBe("");
  });
});

describe("sectorLabel", () => {
  it("collapses casing", () => {
    expect(sectorLabel("INFORMATION TECHNOLOGY")).toBe("Information Technology");
    expect(sectorLabel("Real  estate")).toBe("Real Estate");
    expect(sectorLabel("")).toBe("");
  });
  it("shortens long sector names for tight rows", () => {
    expect(sectorShort("INFORMATION TECHNOLOGY")).toBe("Info Tech");
    expect(sectorShort("Energy")).toBe("Energy");
  });
});

describe("dates and freshness", () => {
  it("formats ISO dates without timezone drift", () => {
    expect(formatShortDate("2026-10-09")).toBe("Oct 9");
    expect(formatShortDate("2026-09-25")).toBe("Sep 25");
    expect(formatShortDate("")).toBe("");
  });
  it("labels stale funds as older disclosures, never 'no trades'", () => {
    expect(freshnessLabel({ stale: true, date: "2026-09-25" })).toEqual({
      stale: true,
      text: "Older disclosure · Sep 25",
    });
    expect(freshnessLabel({ stale: true, date: null }).text).toBe("Older disclosure");
  });
  it("labels fresh funds with their source date", () => {
    expect(freshnessLabel({ stale: false, date: "2026-10-09" })).toEqual({ stale: false, text: "As of Oct 9" });
  });
});

describe("formatShares", () => {
  it("adds separators and signs", () => {
    expect(formatShares(209486)).toBe("+209,486");
    expect(formatShares(-7502)).toBe("\u22127,502");
    expect(formatShares(0)).toBe("0");
    expect(formatShares(null)).toBe("—");
  });
});
