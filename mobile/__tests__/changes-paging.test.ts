import { loadCompleteChanges } from "../lib/discovery/paged-changes";
import type { ChangesResponse } from "../lib/discovery/types";
import changesFixture from "./fixtures/discovery-changes.json";
import fundsFixture from "./fixtures/discovery-funds.json";
import type { FundSummary } from "../lib/types";
const changes = changesFixture as ChangesResponse;
const funds = fundsFixture as { funds: FundSummary[] };
const sample = changes.changes[0];
function page(p: number, total = 10125): ChangesResponse {
  const rows = Array.from(
    { length: Math.max(0, Math.min(2000, total - (p - 1) * 2000)) },
    (_, i) => ({ ...sample, ticker: `P${(p - 1) * 2000 + i}` }),
  );
  return {
    asOfDate: changes.asOfDate,
    snapshot: "snapshot-a",
    page: p,
    size: 2000,
    pages: Math.ceil(total / 2000),
    total,
    count: rows.length,
    changes: rows,
  };
}
test("complete page union needs six calls, no metadata request, with at most three concurrent", async () => {
  const seen: number[] = [];
  let active = 0,
    max = 0;
  const getFunds = jest.fn(async () => funds.funds);
  const result = await loadCompleteChanges(async (query) => {
    seen.push(query.page!);
    active++;
    max = Math.max(active, max);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    active--;
    expect(query.limit).toBe(5000);
    expect(query.size).toBe(2000);
    if (query.page! > 1) expect(query.snapshot).toBe("snapshot-a");
    return page(query.page!);
  }, getFunds);
  expect(result.count).toBe(10125);
  expect(result.truncated).toBe(false);
  expect(new Set(result.changes.map((r) => r.ticker)).size).toBe(10125);
  expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  expect(max).toBe(3);
  expect(getFunds).not.toHaveBeenCalled();
});
test("old-server fallback still completes provider/fund capped rows", async () => {
  const seen: object[] = [];
  const result = await loadCompleteChanges(
    async (query) => {
      seen.push(query);
      if (!query.provider && !query.fund) return { ...changes, count: 5000 };
      return { ...changes, count: changes.changes.length };
    },
    async () => funds.funds,
  );
  expect(seen[0]).toEqual({ page: 1, size: 2000, limit: 5000 });
  expect(seen.some((q) => "provider" in q || "fund" in q)).toBe(true);
  expect(result.truncated).toBe(false);
});
test("uncapped legacy fallback skips metadata and irreducible caps remain labelled", async () => {
  const getFunds = jest.fn(async () => []);
  expect(
    (
      await loadCompleteChanges(
        async () => ({ ...changes, count: 8 }),
        getFunds,
      )
    ).count,
  ).toBe(8);
  expect(getFunds).not.toHaveBeenCalled();
  expect(
    (
      await loadCompleteChanges(
        async () => ({ ...changes, count: 5000 }),
        getFunds,
      )
    ).truncated,
  ).toBe(true);
});
test.each([
  "snapshot",
  "asOfDate",
  "total",
  "page",
  "pages",
  "size",
  "count",
  "duplicate",
])("rejects inconsistent or incomplete paged %s", async (field) => {
  await expect(
    loadCompleteChanges(
      async (query) => {
        const body = page(query.page!, 2500);
        if (query.page === 2) {
          if (field === "duplicate") body.changes[0] = page(1, 2500).changes[0];
          else if (field === "snapshot" || field === "asOfDate")
            (body as any)[field] = "changed";
          else (body as any)[field] += 1;
        }
        return body;
      },
      async () => [],
    ),
  ).rejects.toThrow();
});
test("empty paged universe returns immediately and malformed metadata never falls back", async () => {
  const getFunds = jest.fn(async () => []);
  expect(
    (await loadCompleteChanges(async () => page(1, 0), getFunds)).count,
  ).toBe(0);
  expect(getFunds).not.toHaveBeenCalled();
  await expect(
    loadCompleteChanges(async () => ({ ...changes, total: 100 }), getFunds),
  ).rejects.toThrow();
});
