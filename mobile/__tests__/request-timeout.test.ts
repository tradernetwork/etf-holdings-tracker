import { fetchWithRetry, fetchWithTimeout, TimeoutError } from "../lib/retry";

const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

describe("fetchWithTimeout", () => {
  it("rejects with TimeoutError when the server never answers, even if fetch ignores abort", async () => {
    await expect(fetchWithTimeout(hang, "http://x", {}, 20)).rejects.toBeInstanceOf(TimeoutError);
  });
  it("passes a response straight through", async () => {
    const ok = { ok: true, status: 200 } as Response;
    await expect(fetchWithTimeout((async () => ok) as unknown as typeof fetch, "http://x", {}, 1000)).resolves.toBe(ok);
  });
});

describe("fetchWithRetry deadline", () => {
  it("a hung request ends in an error instead of retrying forever", async () => {
    const calls = jest.fn(hang);
    await expect(fetchWithRetry(calls as unknown as typeof fetch, "http://x", {}, { deadlineMs: 1000, sleep: async () => {} })).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it("stops retrying a 500 once the time budget is spent", async () => {
    let t = 0;
    const res500 = { ok: false, status: 500, headers: { get: () => null } } as unknown as Response;
    const f = jest.fn(async () => res500);
    const out = await fetchWithRetry(f as unknown as typeof fetch, "http://x", {}, {
      deadlineMs: 2500,
      baseMs: 1000,
      now: () => t,
      sleep: async (ms) => { t += ms; },
    });
    expect(out.status).toBe(500);
    expect(f.mock.calls.length).toBeLessThan(4); // 1s + 2s backoff would blow a 2.5s budget
  });
});
