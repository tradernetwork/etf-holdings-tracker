import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Category, CategoryChoice } from "./types";

// Holdings land once a day, so a few minutes of staleness costs nothing and
// saves mobile data; React Query also dedupes screens that share a payload.
const STALE_MS = 5 * 60 * 1000;
const cat = (c: CategoryChoice): Category | undefined => (c === "all" ? undefined : c);

export const useSignals = (c: CategoryChoice) =>
  useQuery({ queryKey: ["signals", c], queryFn: ({ signal }) => api.signals(cat(c), signal), staleTime: STALE_MS });

export const useDivergences = (c: CategoryChoice) =>
  useQuery({ queryKey: ["divergences", c], queryFn: ({ signal }) => api.divergences(cat(c), signal), staleTime: STALE_MS });

export const useSectors = (c: CategoryChoice) =>
  useQuery({ queryKey: ["sectors", c], queryFn: ({ signal }) => api.sectors(cat(c), signal), staleTime: STALE_MS });

export const useLayering = () =>
  useQuery({ queryKey: ["layering"], queryFn: ({ signal }) => api.layering(signal), staleTime: STALE_MS });

export const useFunds = () =>
  useQuery({ queryKey: ["funds"], queryFn: ({ signal }) => api.funds(signal), staleTime: STALE_MS });

export const useTicker = (symbol: string) =>
  useQuery({ queryKey: ["ticker", symbol], queryFn: ({ signal }) => api.ticker(symbol, signal), staleTime: STALE_MS });

export const useFund = (fund: string) =>
  useQuery({ queryKey: ["fund", fund], queryFn: ({ signal }) => api.fund(fund, signal), staleTime: STALE_MS });
