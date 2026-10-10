/**
 * Fetch with exponential backoff, for the notification calls. Same policy as the
 * data client in api.ts: network failures and transient statuses retry; every
 * other answer is final. 503 is NOT retried: the notifications backend uses it to
 * say "disabled", and the client stays silent rather than hammering it.
 */
export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  { retries = 3, baseMs = 1000, sleep = defaultSleep }: RetryOptions = {},
): Promise<Response> {
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
    const transient = res.status === 429 || (res.status >= 500 && res.status !== 503);
    if (transient && canRetry) {
      await sleep(baseMs * 2 ** attempt);
      continue;
    }
    return res;
  }
}
