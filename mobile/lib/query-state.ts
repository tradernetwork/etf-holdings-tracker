/**
 * One state machine for every data screen, so loading / error / stale-cache read the same everywhere.
 *  - loading: first fetch, nothing cached yet (show a skeleton, never an "empty" message)
 *  - error:   the fetch failed and there is nothing cached to show (plain copy + Retry)
 *  - stale:   a refresh failed but cached data is still on screen (keep it, add a "last loaded" note)
 *  - ready:   data is in hand
 */
export type QueryUiState = "loading" | "error" | "stale" | "ready";

export const LOAD_ERROR_COPY = "Couldn't load this. Check your connection and try again.";
export const STALE_COPY = "Showing last loaded data. Couldn't refresh.";

export interface QueryLike {
  isLoading: boolean;
  isError: boolean;
  data?: unknown;
}

export function queryUiState(q: QueryLike): QueryUiState {
  const hasData = q.data !== undefined;
  if (q.isError) return hasData ? "stale" : "error";
  if (q.isLoading && !hasData) return "loading";
  return "ready";
}

/** True once it is safe to say "nothing here": loaded, and truly empty. Never while loading or failed. */
export const showEmpty = (q: QueryLike, rowCount: number): boolean => queryUiState(q) === "ready" && q.data !== undefined && rowCount === 0;
