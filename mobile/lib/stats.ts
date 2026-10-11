/** /api/v1/stats: the website's income page shows its put/call ratio chip from this. */
import { useQuery } from "@tanstack/react-query";
import { ApiError, NetworkError } from "./api";
import { fetchWithRetry } from "./retry";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

export interface GlobalStats {
  asOfDate: string;
  fundsTracked: number;
  uniqueTickers: number;
  optionsContracts: number;
  /** Puts / calls across the day's option positions; 0 when no calls. */
  putCallRatio: number;
  newPositionsToday: number;
  exitsToday: number;
}

export async function fetchStats(signal?: AbortSignal): Promise<GlobalStats> {
  let res: Response;
  try {
    res = await fetchWithRetry(fetch, `${API_BASE}/api/v1/stats`, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new NetworkError(e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as GlobalStats;
}

/** The website prints it to two decimals ("0.62"); a missing or non-finite value shows no chip. */
export const formatPutCall = (v: number | null | undefined): string | null => (v == null || !Number.isFinite(v) ? null : v.toFixed(2));

export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: ({ signal }) => fetchStats(signal), staleTime: 5 * 60 * 1000 });
