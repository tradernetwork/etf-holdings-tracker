import { completeChanges } from "./complete-changes";
import type { ChangesResponse } from "./types";
import type { FundSummary } from "../types";
export type ChangeQuery = {
  page?: number;
  size?: number;
  limit?: number;
  snapshot?: string;
  fund?: string;
  provider?: string;
};
const PAGE_SIZE = 2000;
const CONCURRENCY = 3;
const error = () =>
  new Error(
    "Incomplete or changed snapshot while loading. Refresh to restart at page 1.",
  );
function validatePage(
  body: ChangesResponse,
  expected: number,
  first?: ChangesResponse,
) {
  if (
    ![body.page, body.size, body.total, body.pages].every(Number.isInteger) ||
    body.page !== expected ||
    body.size !== PAGE_SIZE ||
    body.total! < 0 ||
    body.pages !== Math.ceil(body.total! / PAGE_SIZE) ||
    !body.snapshot ||
    !body.asOfDate ||
    body.changes.length !==
      Math.max(
        0,
        Math.min(PAGE_SIZE, body.total! - (expected - 1) * PAGE_SIZE),
      ) ||
    body.count !== body.changes.length ||
    (first &&
      (body.snapshot !== first.snapshot ||
        body.asOfDate !== first.asOfDate ||
        body.total !== first.total ||
        body.pages !== first.pages))
  )
    throw error();
}
/** Metadata opts into paging; servers that ignore page/size retain the old split path. */
export async function loadCompleteChanges(
  load: (query: ChangeQuery) => Promise<ChangesResponse>,
  funds: () => Promise<FundSummary[]>,
): Promise<ChangesResponse> {
  // An old server ignores page/size but honours limit, so this probe is its first legacy load too.
  const first = await load({ page: 1, size: PAGE_SIZE, limit: 5000 });
  if (
    first.total === undefined &&
    first.page === undefined &&
    first.pages === undefined &&
    first.size === undefined &&
    first.snapshot === undefined
  ) {
    if (first.count < 5000) return { ...first, truncated: false };
    return completeChanges(first, await funds(), load);
  }
  validatePage(first, 1);
  const responses = [first];
  for (let page = 2; page <= first.pages!; page += CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(CONCURRENCY, first.pages! - page + 1) },
      (_, i) => page + i,
    );
    const results = await Promise.all(
      batch.map(async (p) => {
        const body = await load({
          page: p,
          size: PAGE_SIZE,
          limit: 5000,
          snapshot: first.snapshot,
        });
        validatePage(body, p, first);
        return body;
      }),
    );
    responses.push(...results);
  }
  const changes = responses.flatMap((r) => r.changes);
  const identities = new Set(
    changes.map((r) => `${r.fund}:${r.ticker}:${r.type}`),
  );
  if (changes.length !== first.total || identities.size !== changes.length)
    throw error();
  return { ...first, changes, count: changes.length, truncated: false };
}
