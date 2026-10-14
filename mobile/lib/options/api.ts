/**
 * Fetchers for the option screens. Kept out of lib/api.ts (whose paths are typed from the generated
 * OpenAPI file, which predates /options-listings/schedule) and built on the same retry client.
 */
import { ApiError, NetworkError } from "@/lib/api";
import { fetchWithRetry } from "@/lib/retry";
import type { ActivityPeriod, ActivityResponse, ListingsResponse, MwfSchedule, OptionsByUnderlying } from "./types";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

async function get<T>(path: string, query: Record<string, string | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  let res: Response;
  try {
    res = await fetchWithRetry(fetch, `${API_BASE}${path}${qs ? `?${qs}` : ""}`, { signal, headers: { Accept: "application/json", "X-TickerTrace-Client": "app" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new NetworkError(e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as T;
}

export const optionsApi = {
  /** Market-wide option changes for a window, newest/biggest first as the server sorts them. */
  activity: (period: ActivityPeriod, signal?: AbortSignal) =>
    get<ActivityResponse>("/api/v1/activity", { period }, signal),
  listings: (signal?: AbortSignal) => get<ListingsResponse>("/api/v1/options-listings", {}, signal),
  /** 404 on a server that predates the schedule route (the screen says so instead of faking one). */
  schedule: (signal?: AbortSignal) => get<MwfSchedule>("/api/v1/options-listings/schedule", {}, signal),
  /** 404 when no tracked fund holds options on the symbol. */
  structures: (symbol: string, signal?: AbortSignal) =>
    get<OptionsByUnderlying>(`/api/v1/options/${encodeURIComponent(symbol)}`, {}, signal),
};
