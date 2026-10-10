/**
 * Fetch with exponential backoff, for the notification calls. Same policy as the
 * data client in api.ts: network failures and transient statuses retry; every
 * other answer is final. 503 is NOT retried: the notifications backend uses it to
 * say "disabled", and the client stays silent rather than hammering it.
 *
 * 429 is policy-driven, because the notification quotas are deterministic
 * (e.g. 5 enrolments/day per token, per-IP limits): retrying only burns more quota.
 *  - "retry" (default): ordinary backoff, like any transient status.
 *  - "terminal": never retry; the caller gets the 429 straight away.
 *  - "retry-after-once": honour a Retry-After header with ONE retry; no header => terminal.
 */
export type On429 = "retry" | "terminal" | "retry-after-once";

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  on429?: On429;
  /** Longest Retry-After we are willing to wait (ms). Longer means terminal. */
  maxRetryAfterMs?: number;
  now?: () => number;
}

/** Retry-After as delta-seconds or an HTTP date -> milliseconds to wait, or null if absent/invalid. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  { retries = 3, baseMs = 1000, sleep = defaultSleep, on429 = "retry", maxRetryAfterMs = 30_000, now = Date.now }: RetryOptions = {},
): Promise<Response> {
  let retryAfterUsed = false;
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < retries;
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      if (!canRetry) throw e;
      await sleep(baseMs * 2 ** attempt);
      continue;
    }
    if (res.status === 429 && on429 !== "retry") {
      if (on429 === "retry-after-once" && !retryAfterUsed) {
        const wait = parseRetryAfter(res.headers?.get?.("Retry-After"), now());
        if (wait !== null && wait <= maxRetryAfterMs) {
          retryAfterUsed = true;
          await sleep(wait);
          continue;
        }
      }
      return res; // terminal: the caller maps 429 to rate-limited
    }
    const transient = res.status === 429 || (res.status >= 500 && res.status !== 503);
    if (transient && canRetry) {
      await sleep(baseMs * 2 ** attempt);
      continue;
    }
    return res;
  }
}
