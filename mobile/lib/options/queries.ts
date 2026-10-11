import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { optionsApi } from "./api";
import type { ActivityPeriod } from "./types";

const STALE_MS = 5 * 60 * 1000;
/** A 404 is an answer ("none", "not on this server"), not a failure worth retrying. */
const retryUnless404 = (n: number, e: unknown) => !(e instanceof ApiError && e.status === 404) && n < 1;

export const useOptionActivity = (period: ActivityPeriod) =>
  useQuery({ queryKey: ["options-activity", period], queryFn: ({ signal }) => optionsApi.activity(period, signal), staleTime: STALE_MS });

export const useOptionListings = () =>
  useQuery({ queryKey: ["options-listings"], queryFn: ({ signal }) => optionsApi.listings(signal), staleTime: STALE_MS });

export const useMwfSchedule = () =>
  useQuery({ queryKey: ["options-schedule"], queryFn: ({ signal }) => optionsApi.schedule(signal), staleTime: STALE_MS, retry: retryUnless404 });

export const useOptionStructures = (symbol: string) =>
  useQuery({
    queryKey: ["options-structures", symbol],
    queryFn: ({ signal }) => optionsApi.structures(symbol, signal),
    staleTime: STALE_MS,
    retry: retryUnless404,
  });
