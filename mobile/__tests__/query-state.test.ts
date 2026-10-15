import { LOAD_ERROR_COPY, queryUiState, showEmpty } from "../lib/query-state";

describe("queryUiState", () => {
  it("first load with nothing cached is loading", () => {
    expect(queryUiState({ isLoading: true, isError: false, data: undefined })).toBe("loading");
  });
  it("failed first load is an error, never a spinner", () => {
    expect(queryUiState({ isLoading: false, isError: true, data: undefined })).toBe("error");
  });
  it("failed refresh over cached data keeps the data (stale)", () => {
    expect(queryUiState({ isLoading: false, isError: true, data: { rows: [] } })).toBe("stale");
  });
  it("loaded is ready, including an empty payload", () => {
    expect(queryUiState({ isLoading: false, isError: false, data: [] })).toBe("ready");
  });
});

describe("showEmpty", () => {
  it("never claims empty while loading or failed", () => {
    expect(showEmpty({ isLoading: true, isError: false }, 0)).toBe(false);
    expect(showEmpty({ isLoading: false, isError: true }, 0)).toBe(false);
  });
  it("only when loaded and truly empty", () => {
    expect(showEmpty({ isLoading: false, isError: false, data: {} }, 0)).toBe(true);
    expect(showEmpty({ isLoading: false, isError: false, data: {} }, 3)).toBe(false);
  });
});

test("error copy is plain and has no em dash", () => {
  expect(LOAD_ERROR_COPY).toBe("Couldn't load this. Check your connection and try again.");
  expect(LOAD_ERROR_COPY).not.toContain("\u2014");
});
