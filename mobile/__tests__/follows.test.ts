import { MAX_FOLLOWS, isFollowing, parseFollows, serializeFollows, toggleFollow, type Follow } from "../lib/follows";

describe("toggleFollow", () => {
  it("adds newest-first, normalising case", () => {
    let r = toggleFollow([], "ticker", "aapl");
    expect(r).toMatchObject({ added: true, limitReached: false });
    r = toggleFollow(r.list, "fund", "ARKK");
    expect(r.list).toEqual([{ kind: "fund", symbol: "ARKK" }, { kind: "ticker", symbol: "AAPL" }]);
  });
  it("removes when already followed, and reports added=false", () => {
    const start: Follow[] = [{ kind: "ticker", symbol: "AAPL" }];
    const r = toggleFollow(start, "ticker", "AAPL");
    expect(r.list).toEqual([]);
    expect(r.added).toBe(false);
  });
  it("treats a ticker and a fund with the same symbol as different follows", () => {
    const r = toggleFollow([{ kind: "ticker", symbol: "ULTY" }], "fund", "ULTY");
    expect(r.list).toHaveLength(2);
    expect(isFollowing(r.list, "fund", "ulty")).toBe(true);
  });
  it("refuses invalid symbols and a full list", () => {
    expect(toggleFollow([], "ticker", "not a symbol!").list).toEqual([]);
    const full: Follow[] = Array.from({ length: MAX_FOLLOWS }, (_, i) => ({ kind: "ticker", symbol: `T${i}` }));
    const r = toggleFollow(full, "ticker", "NEW");
    expect(r).toMatchObject({ added: false, limitReached: true });
    expect(r.list).toHaveLength(MAX_FOLLOWS);
  });
});

describe("persistence round trip", () => {
  it("serialises and parses", () => {
    const list: Follow[] = [{ kind: "fund", symbol: "ARKK" }, { kind: "ticker", symbol: "AAPL" }];
    expect(parseFollows(serializeFollows(list))).toEqual(list);
  });
  it("survives corrupt or hostile storage", () => {
    expect(parseFollows(null)).toEqual([]);
    expect(parseFollows("{not json")).toEqual([]);
    expect(parseFollows('{"a":1}')).toEqual([]);
    expect(parseFollows('[1,null,{"kind":"x","symbol":"A"},{"kind":"ticker","symbol":"ok"},{"kind":"ticker","symbol":"OK"}]'))
      .toEqual([{ kind: "ticker", symbol: "OK" }]);
  });
});
