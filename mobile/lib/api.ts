/**
 * Typed client for the public TickerTrace API (https://api.tickertrace.pro).
 * Open, read-only, no auth. Retry/backoff wrapper ported from vero's lib/api.ts
 * (minus Clerk auth and the offline write-queue: nothing here is ever written).
 */
import type { paths } from "./generated/api-types";
import type { FundsResponse, SignalsResponse } from "./types";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

/** Only routes that exist in the OpenAPI spec compile. */
type GetPath = {
  [P in keyof paths]: paths[P] extends { get: unknown } ? P : never;
}[keyof paths];

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000; // 1s, 2s, 4s: rides out a cold start without feeling dead

/** The server answered with a non-2xx status. 4xx will not succeed on retry. */
export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API ${status}: ${body.slice(0, 200)}`);
    this.name = "ApiError";
  }
}

/** The request never got an answer (offline, DNS, timeout) after all retries. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function request<T>(
  path: GetPath,
  query?: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;

  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < MAX_RETRIES;
    let res: Response;
    try {
      res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (!canRetry) throw new NetworkError(e instanceof Error ? e.message : "network error");
      await delay(BACKOFF_BASE_MS * 2 ** attempt);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    // 5xx / 429 are transient; every other 4xx is final.
    if ((res.status >= 500 || res.status === 429) && canRetry) {
      await delay(BACKOFF_BASE_MS * 2 ** attempt);
      continue;
    }
    throw new ApiError(res.status, await res.text().catch(() => ""));
  }
}

export const api = {
  signals: (category?: "active-equity" | "option-income", signal?: AbortSignal) =>
    request<SignalsResponse>("/api/v1/signals", { category }, signal),
  funds: (category?: "active-equity" | "option-income", signal?: AbortSignal) =>
    request<FundsResponse>("/api/v1/funds", { category }, signal),
};
