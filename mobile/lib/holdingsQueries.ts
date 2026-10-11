import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchHoldings, loadsWhole, serverAsset, type HoldingsFilters } from "./holdingsBrowser";

/** A whole-loaded book is keyed by what the server sees (fund, search, asset), so paging/sorting never refetches it. */
export function holdingsKey(f: HoldingsFilters): unknown[] {
  const base = ["holdings", f.fund, f.q.trim(), serverAsset(f.kind) ?? "all"];
  return loadsWhole(f) ? [...base, "whole"] : [...base, f.page, f.size, f.sort, f.dir];
}

export const useHoldings = (f: HoldingsFilters) =>
  useQuery({
    queryKey: holdingsKey(f),
    queryFn: ({ signal }) => fetchHoldings(f, signal),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
