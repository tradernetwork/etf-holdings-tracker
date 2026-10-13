import avuv from "./fixtures/avuv-fund.json";
import msty from "./fixtures/msty-fund.json";
import qdte from "./fixtures/qdte-fund.json";
import ymaxFund from "./fixtures/ymax-fund.json";
import ymaxIncome from "./fixtures/ymax-income.json";
import mstyIncome from "./fixtures/msty-income.json";
import { fundHasOptions } from "../lib/optionPresence";

describe("option columns appear only on funds that hold options", () => {
  it("AVUV (equity, no options) has none", () => {
    expect((avuv as { optionsCount: number }).optionsCount).toBe(0);
    expect(fundHasOptions(avuv as never)).toBe(false);
  });
  it("MSTY and QDTE (options) keep everything", () => {
    expect(fundHasOptions(msty as never)).toBe(true);
    expect(fundHasOptions(msty as never, mstyIncome as never)).toBe(true);
    expect(fundHasOptions(qdte as never)).toBe(true);
  });
  it("an income fund with no options (YMAX) has none, from the fund or its income book", () => {
    expect((ymaxFund as { optionsCount: number }).optionsCount).toBe(0);
    expect(fundHasOptions(ymaxFund as never)).toBe(false);
    expect(fundHasOptions(ymaxFund as never, ymaxIncome as never)).toBe(false);
  });
  it("a single leg anywhere is enough: nothing that exists is hidden", () => {
    expect(fundHasOptions({ optionsCount: 1 })).toBe(true);
    expect(fundHasOptions({ optionsCount: 0, optionHoldings: [{}] })).toBe(true);
    expect(fundHasOptions({ optionsCount: 0 }, { positions: [{ legs: [{}] }] })).toBe(true);
    expect(fundHasOptions({ optionsCount: 0 }, { positions: [{ legs: [] }], counts: { optionLegs: 2 } })).toBe(true);
  });
  it("unknown means show everything", () => {
    expect(fundHasOptions(undefined)).toBe(true);
  });
});
