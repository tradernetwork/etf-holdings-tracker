import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

// Holdings land once a day, so a few minutes of staleness costs nothing and
// saves mobile data; React Query also dedupes the two tabs that will share this.
const STALE_MS = 5 * 60 * 1000;

export const useSignals = () =>
  useQuery({ queryKey: ["signals"], queryFn: ({ signal }) => api.signals(undefined, signal), staleTime: STALE_MS });

export const useFunds = () =>
  useQuery({ queryKey: ["funds"], queryFn: ({ signal }) => api.funds(undefined, signal), staleTime: STALE_MS });
