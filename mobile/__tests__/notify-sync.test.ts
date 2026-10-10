import { createSecureDeviceStore, parseStoredDevice, webDeviceStore, type DeviceStore, type StoredDevice } from "../lib/device-store";
import type { Follow } from "../lib/follows";
import { NotifySync } from "../lib/notify-sync";
import { createNotifyApi, followsPayload, type ApiResult, type DeviceRegistration, type NotifyApi } from "../lib/notifyApi";

const F1: Follow[] = [{ kind: "ticker", symbol: "AAPL" }];
const F2: Follow[] = [{ kind: "fund", symbol: "ARKK" }, ...F1];
const F3: Follow[] = [{ kind: "ticker", symbol: "TSLA" }, ...F2];
const reg = (n: number): DeviceRegistration => ({ deviceId: `dev-${n}`, secret: `secret-${n}` });
const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function memoryStore(initial: StoredDevice | null = null) {
  let v = initial;
  const store: DeviceStore & { peek: () => StoredDevice | null } = {
    get: jest.fn(async () => v),
    set: jest.fn(async (d: StoredDevice) => { v = d; }),
    clear: jest.fn(async () => { v = null; }),
    peek: () => v,
  };
  return store;
}

/** A fake API whose responses are scripted per method, then default to success. */
function fakeApi(script: { subscribe?: ApiResult<DeviceRegistration>[]; put?: ApiResult<null>[]; del?: ApiResult<null>[] } = {}) {
  let n = 0;
  const q = { subscribe: [...(script.subscribe ?? [])], put: [...(script.put ?? [])], del: [...(script.del ?? [])] };
  const api = {
    subscribe: jest.fn(async () => q.subscribe.shift() ?? ok(reg(++n))),
    putFollows: jest.fn(async () => q.put.shift() ?? ok(null)),
    deleteDevice: jest.fn(async () => q.del.shift() ?? ok(null)),
  };
  return api as typeof api & NotifyApi;
}

/** Manual timers so the debounce is deterministic. */
function manualTimers() {
  let fn: (() => void) | null = null;
  return {
    setTimer: jest.fn((f: () => void) => { fn = f; return 1; }),
    clearTimer: jest.fn(() => { fn = null; }),
    fire: () => { const f = fn; fn = null; f?.(); },
    pending: () => fn !== null,
  };
}

const make = (over: Partial<ConstructorParameters<typeof NotifySync>[0]> = {}, store = memoryStore(), api = fakeApi(), timers = manualTimers()) => {
  const sync = new NotifySync({ api, store, enabled: true, platform: "android", setTimer: timers.setTimer, clearTimer: timers.clearTimer, ...over });
  return { sync, store, api, timers };
};

describe("flag off / web: zero network and zero storage", () => {
  it.each([
    ["flag off", { enabled: false, platform: "android" }],
    ["web", { enabled: true, platform: "web" }],
  ])("%s", async (_n, over) => {
    const { sync, store, api, timers } = make(over);
    expect(await sync.onEnabled("tok", F1)).toBe("skipped");
    expect(await sync.onLaunch("tok", F1)).toBe("skipped");
    sync.onFollowsChanged(F2, "tok");
    expect(timers.pending()).toBe(false);
    expect(await sync.flush()).toBe("skipped");
    expect(await sync.onDisabled()).toBe("skipped");
    for (const m of Object.values(api)) expect(m).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });
});

describe("lifecycle: subscribe -> edit -> disable -> re-enable", () => {
  it("stores the secret, debounces edits into one PUT of the full list, deletes on disable, re-registers on re-enable", async () => {
    const { sync, store, api, timers } = make();

    expect(await sync.onEnabled("tokA", F1)).toBe("synced");
    expect(api.subscribe).toHaveBeenCalledWith("tokA", null);
    expect(store.peek()).toEqual({ deviceId: "dev-1", secret: "secret-1", token: "tokA" });
    expect(api.putFollows).toHaveBeenLastCalledWith("secret-1", F1);

    // Three quick edits -> a single PUT carrying the LATEST complete list.
    sync.onFollowsChanged(F2, "tokA");
    sync.onFollowsChanged(F3, "tokA");
    expect(api.putFollows).toHaveBeenCalledTimes(1); // nothing yet: debounced
    expect(timers.clearTimer).toHaveBeenCalled(); // the earlier timer was reset
    timers.fire();
    await sync.flush(); // flush is a no-op once the timer already ran
    await new Promise<void>((r) => setImmediate(() => r()));
    expect(api.putFollows).toHaveBeenCalledTimes(2);
    expect(api.putFollows).toHaveBeenLastCalledWith("secret-1", F3);

    // Disable: DELETE server-side first, then the secret is wiped.
    expect(await sync.onDisabled()).toBe("synced");
    expect(api.deleteDevice).toHaveBeenCalledWith("secret-1");
    expect(store.peek()).toBeNull();

    // Re-enable: a fresh registration with a new secret.
    expect(await sync.onEnabled("tokA", F3)).toBe("synced");
    expect(api.subscribe).toHaveBeenCalledTimes(2);
    expect(store.peek()?.secret).toBe("secret-2");
    expect(api.putFollows).toHaveBeenLastCalledWith("secret-2", F3);
  });

  it("an edit with no registration yet registers first (e.g. after Clear my follows)", async () => {
    const { sync, api, store, timers } = make();
    sync.onFollowsChanged(F1, "tokA");
    timers.fire();
    await new Promise<void>((r) => setImmediate(() => r()));
    expect(api.subscribe).toHaveBeenCalledTimes(1);
    expect(store.peek()?.token).toBe("tokA");
    expect(api.putFollows).toHaveBeenCalledWith("secret-1", F1);
  });

  it("does not schedule anything when notifications have no token (opted in, no EAS project)", () => {
    const { sync, timers } = make();
    sync.onFollowsChanged(F1, null);
    expect(timers.pending()).toBe(false);
  });

  it("disable cancels a pending debounced edit", async () => {
    const { sync, api, timers } = make({}, memoryStore({ deviceId: "d", secret: "s", token: "t" }));
    sync.onFollowsChanged(F2, "t");
    await sync.onDisabled();
    timers.fire();
    expect(api.putFollows).not.toHaveBeenCalled();
  });
});

describe("401: the server forgot the secret", () => {
  it("clears it, re-subscribes ONCE and retries the PUT once", async () => {
    const store = memoryStore({ deviceId: "old", secret: "stale", token: "tokA" });
    const api = fakeApi({ put: [{ ok: false, kind: "unauthorized" }] });
    const { sync } = make({}, store, api);
    expect(await sync.onEnabled("tokA", F2)).toBe("synced");
    expect(api.subscribe).toHaveBeenCalledTimes(1);
    expect(api.subscribe).toHaveBeenCalledWith("tokA", null); // fresh registration, no stale bearer
    expect(api.putFollows).toHaveBeenCalledTimes(2);
    expect(api.putFollows).toHaveBeenNthCalledWith(1, "stale", F2);
    expect(api.putFollows).toHaveBeenNthCalledWith(2, "secret-1", F2);
    expect(store.peek()?.secret).toBe("secret-1");
  });
  it("gives up after one recovery instead of looping", async () => {
    const api = fakeApi({ put: [{ ok: false, kind: "unauthorized" }, { ok: false, kind: "unauthorized" }] });
    const { sync } = make({}, memoryStore({ deviceId: "o", secret: "x", token: "t" }), api);
    expect(await sync.onEnabled("t", F1)).toBe("failed");
    expect(api.subscribe).toHaveBeenCalledTimes(1);
    expect(api.putFollows).toHaveBeenCalledTimes(2);
  });
  it("on disable, a 401 means the server already forgot us: the secret is wiped", async () => {
    const store = memoryStore({ deviceId: "d", secret: "s", token: "t" });
    const { sync } = make({}, store, fakeApi({ del: [{ ok: false, kind: "unauthorized" }] }));
    expect(await sync.onDisabled()).toBe("synced");
    expect(store.peek()).toBeNull();
  });
});

describe("503: backend disabled", () => {
  it("stays silent and keeps local state", async () => {
    const store = memoryStore();
    const { sync } = make({}, store, fakeApi({ subscribe: [{ ok: false, kind: "disabled" }] }));
    await expect(sync.onEnabled("t", F1)).resolves.toBe("silent");
    expect(store.set).not.toHaveBeenCalled();
  });
  it("a 503 on delete keeps the secret so a later attempt can still delete", async () => {
    const store = memoryStore({ deviceId: "d", secret: "s", token: "t" });
    const { sync } = make({}, store, fakeApi({ del: [{ ok: false, kind: "disabled" }] }));
    expect(await sync.onDisabled()).toBe("silent");
    expect(store.peek()?.secret).toBe("s");
  });
  it("a network failure on delete keeps the secret too", async () => {
    const store = memoryStore({ deviceId: "d", secret: "s", token: "t" });
    const { sync } = make({}, store, fakeApi({ del: [{ ok: false, kind: "network", detail: "offline" }] }));
    expect(await sync.onDisabled()).toBe("failed");
    expect(store.peek()?.secret).toBe("s");
  });
});

describe("409: token already enrolled and we lost its secret", () => {
  it("is a terminal failure: no retry, no loop, nothing stored", async () => {
    const store = memoryStore();
    const api = fakeApi({ subscribe: [{ ok: false, kind: "conflict" }] });
    const { sync } = make({}, store, api);
    expect(await sync.onEnabled("tokA", F1)).toBe("failed");
    expect(api.subscribe).toHaveBeenCalledTimes(1);
    expect(store.set).not.toHaveBeenCalled();
    expect(api.putFollows).not.toHaveBeenCalled();
  });
  it("logs the 409 and 422 terminal cases without leaking secrets or tokens", async () => {
    const log = jest.fn();
    const a = make({ log }, memoryStore(), fakeApi({ subscribe: [{ ok: false, kind: "conflict" }] }));
    await a.sync.onEnabled("ExponentPushToken[abc]", F1);
    const b = make({ log }, memoryStore({ deviceId: "d", secret: "topsecret", token: "t" }), fakeApi({ put: [{ ok: false, kind: "error", status: 422 }] }));
    await b.sync.onEnabled("t", F1);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("409"))).toBe(true);
    expect(lines.some((l) => l.includes("422"))).toBe(true);
    expect(lines.join(" ")).not.toMatch(/topsecret|ExponentPushToken/);
    expect(b.api.subscribe).not.toHaveBeenCalled(); // 422 never triggers a re-registration
    expect(b.api.putFollows).toHaveBeenCalledTimes(1); // and is never retried
  });
  it("notifyApi maps 409 to conflict without retrying", async () => {
    const f = jest.fn(async () => ({ status: 409, ok: false, json: async () => ({}) }) as Response);
    const r = await createNotifyApi(f as never, { sleep: async () => {}, retries: 2, baseMs: 1 }).subscribe("tok");
    expect(r).toEqual({ ok: false, kind: "conflict" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("422 on PUT is final (not retried) and does not drop the registration", async () => {
    const f = jest.fn(async () => ({ status: 422, ok: false, json: async () => ({}) }) as Response);
    const r = await createNotifyApi(f as never, { sleep: async () => {}, retries: 2, baseMs: 1 }).putFollows("s", F1);
    expect(r).toEqual({ ok: false, kind: "error", status: 422 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("repeat delete answering 401 (already removed) wipes the local secret", async () => {
    const store = memoryStore({ deviceId: "d", secret: "s", token: "t" });
    const { sync } = make({}, store, fakeApi({ del: [{ ok: false, kind: "unauthorized" }] }));
    expect(await sync.onDisabled()).toBe("synced");
    expect(store.peek()).toBeNull();
  });
});

describe("token rotation on launch", () => {
  it("does nothing when the token is unchanged or unavailable", async () => {
    const { sync, api } = make({}, memoryStore({ deviceId: "d", secret: "s", token: "tokA" }));
    expect(await sync.onLaunch("tokA", F1)).toBe("skipped");
    expect(await sync.onLaunch(null, F1)).toBe("skipped");
    expect(api.subscribe).not.toHaveBeenCalled();
  });
  it("re-subscribes with the existing secret (authenticated replacement) when the token changed", async () => {
    const store = memoryStore({ deviceId: "d", secret: "s", token: "tokA" });
    const { sync, api } = make({}, store);
    expect(await sync.onLaunch("tokB", F1)).toBe("synced");
    expect(api.subscribe).toHaveBeenCalledWith("tokB", "s");
    expect(store.peek()?.token).toBe("tokB");
    expect(api.putFollows).toHaveBeenCalled();
  });
});

describe("notifyApi over a mocked fetch (status mapping + backoff)", () => {
  const res = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
  const noWait = { sleep: async () => {}, retries: 2, baseMs: 1 };

  it("503 maps to disabled and is NOT retried", async () => {
    const f = jest.fn(async () => res(503));
    const r = await createNotifyApi(f as never, noWait).putFollows("s", F1);
    expect(r).toEqual({ ok: false, kind: "disabled" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("401 maps to unauthorized without retry", async () => {
    const f = jest.fn(async () => res(401));
    expect(await createNotifyApi(f as never, noWait).putFollows("s", F1)).toEqual({ ok: false, kind: "unauthorized" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("retries 5xx and network errors with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const f = jest.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(200, reg(1)));
    const r = await createNotifyApi(f as never, { retries: 3, baseMs: 10, sleep: async (ms) => { sleeps.push(ms); } }).subscribe("tok");
    expect(r).toEqual({ ok: true, data: reg(1) });
    expect(sleeps).toEqual([10, 20]);
  });
  it("reports a network failure once retries are exhausted", async () => {
    const f = jest.fn(async () => { throw new Error("offline"); });
    const r = await createNotifyApi(f as never, noWait).deleteDevice("s");
    expect(r).toMatchObject({ ok: false, kind: "network" });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("sends the bearer secret, and DELETE of an already-gone device (404) counts as success", async () => {
    const f = jest.fn(async () => res(404));
    const r = await createNotifyApi(f as never, noWait, "https://x.test").deleteDevice("sekret");
    expect(r).toEqual({ ok: true, data: null });
    expect(f).toHaveBeenCalledWith("https://x.test/notifications/device", expect.objectContaining({ method: "DELETE", headers: { Authorization: "Bearer sekret" } }));
  });
  it("rejects a malformed subscribe response instead of storing garbage", async () => {
    const f = jest.fn(async () => res(200, { nope: 1 }));
    expect(await createNotifyApi(f as never, noWait).subscribe("t")).toEqual({ ok: false, kind: "error", status: 200 });
  });
  it("sends the planned bodies", async () => {
    expect(followsPayload(F1)).toEqual({ follows: [{ kind: "ticker", symbol: "AAPL" }] });
    const f = jest.fn(async () => res(200, reg(1)));
    await createNotifyApi(f as never, noWait, "https://x.test").subscribe("tok", "old");
    expect(f).toHaveBeenCalledWith("https://x.test/notifications/subscribe", expect.objectContaining({
      method: "POST", body: JSON.stringify({ transport: "expo", token: "tok" }), headers: expect.objectContaining({ Authorization: "Bearer old" }),
    }));
  });
});

describe("device store", () => {
  it("parses only a complete registration", () => {
    expect(parseStoredDevice(JSON.stringify({ deviceId: "d", secret: "s", token: "t" }))).toEqual({ deviceId: "d", secret: "s", token: "t" });
    expect(parseStoredDevice('{"deviceId":"d"}')).toBeNull();
    expect(parseStoredDevice("{bad")).toBeNull();
    expect(parseStoredDevice(null)).toBeNull();
  });
  it("the web store never holds anything", async () => {
    await webDeviceStore.set({ deviceId: "d", secret: "s", token: "t" });
    expect(await webDeviceStore.get()).toBeNull();
  });
  it("the native store round-trips through expo-secure-store", async () => {
    const backing = new Map<string, string>();
    const fake = {
      getItemAsync: async (k: string) => backing.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => { backing.set(k, v); },
      deleteItemAsync: async (k: string) => { backing.delete(k); },
    };
    const s = createSecureDeviceStore(async () => fake);
    await s.set({ deviceId: "d", secret: "s", token: "t" });
    expect([...backing.values()][0]).toContain('"secret":"s"');
    expect(await s.get()).toEqual({ deviceId: "d", secret: "s", token: "t" });
    await s.clear();
    expect(await s.get()).toBeNull();
  });
});

describe("contract test: exact paths, methods, headers and bodies (settled v1)", () => {
  const res = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
  const BASE = "https://x.test";
  const instant = { sleep: async () => {}, retries: 0, baseMs: 1 };
  const calls = () => jest.fn(async (_url: string, _init: RequestInit) => res(200, { deviceId: "d1", secret: "s1" }));

  it("POST /notifications/subscribe: first enrollment has NO Authorization header", async () => {
    const f = calls();
    await createNotifyApi(f as never, instant, BASE).subscribe("ExponentPushToken[abc]");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://x.test/notifications/subscribe");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"transport":"expo","token":"ExponentPushToken[abc]"}');
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
  it("POST /notifications/subscribe with the secret replaces the token (Bearer, same body)", async () => {
    const f = calls();
    await createNotifyApi(f as never, instant, BASE).subscribe("ExponentPushToken[new]", "s1");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://x.test/notifications/subscribe");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"transport":"expo","token":"ExponentPushToken[new]"}');
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer s1" });
  });
  it("PUT /notifications/follows sends the WRAPPED {follows:[...]} body with the bearer", async () => {
    const f = jest.fn(async (_u: string, _i: RequestInit) => res(200, { follows: [] }));
    await createNotifyApi(f as never, instant, BASE).putFollows("s1", [{ kind: "fund", symbol: "ARKK" }, { kind: "ticker", symbol: "AAPL" }]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://x.test/notifications/follows");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"follows":[{"kind":"fund","symbol":"ARKK"},{"kind":"ticker","symbol":"AAPL"}]}');
    expect(JSON.parse(String(init.body))).toEqual({ follows: expect.any(Array) }); // never a bare array
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer s1" });
  });
  it("DELETE /notifications/device has no body and identifies the device only by the bearer (no deviceId header/query)", async () => {
    const f = jest.fn(async (_u: string, _i: RequestInit) => res(200, { deleted: true }));
    await createNotifyApi(f as never, instant, BASE).deleteDevice("s1");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://x.test/notifications/device");
    expect(url).not.toMatch(/\?|deviceId/);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Authorization: "Bearer s1" });
  });
  it("parses the subscribe response {deviceId, secret}", async () => {
    const r = await createNotifyApi(calls() as never, instant, BASE).subscribe("t");
    expect(r).toEqual({ ok: true, data: { deviceId: "d1", secret: "s1" } });
  });
});
