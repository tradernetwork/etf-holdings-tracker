import { ApiError, NetworkError } from "@/lib/api";
import { fetchWithRetry } from "@/lib/retry";
import type { LayeringFull, TodayFull } from "./types";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

async function get<T>(path: string, query: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  let res: Response;
  try {
    res = await fetchWithRetry(fetch, `${API_BASE}${path}${qs ? `?${qs}` : ""}`, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new NetworkError(e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as T;
}

export const todayApi = {
  /** The whole Today payload: every list the API serves (signals, briefing, divergences, sector flow, KPIs). */
  full: (category?: string, limit?: number, signal?: AbortSignal) => get<TodayFull>("/api/v1/signals", { category, limit }, signal),
  /** Layering with the website's controls. `limit` up to 100 returns every pattern the server found. */
  layering: (p: { windowDays: number; minFunds: number; limit: number }, signal?: AbortSignal) =>
    get<LayeringFull>("/api/v1/layering-patterns", { window_days: p.windowDays, min_funds: p.minFunds, limit: p.limit }, signal),
};
