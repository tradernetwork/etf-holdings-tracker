/**
 * The ONLY module that knows the notifications wire shapes (paths, bodies,
 * headers, status meanings). Settled v1 client contract (Codex, 2026-10-10):
 *  - POST /notifications/subscribe {transport:"expo", token} -> {deviceId, secret}; no bearer on first
 *    enrollment. The same POST WITH `Authorization: Bearer <secret>` replaces the token and returns the
 *    same deviceId/secret. Enrolling again with an already-registered token and NO bearer returns 201: the
 *    server erases the old device and issues new credentials (so reinstalls just work); the old secret then
 *    gets 401. The 409 handling below is DEFENSIVE only (an older server that never re-issues secrets).
 *  - GET/PUT /notifications/follows {follows:[{kind,symbol}]}: PUT atomically replaces up to 100,
 *    normalises, dedupes; 422 for an unknown fund / invalid symbol / bad body.
 *  - DELETE /notifications/device (alias /unsubscribe) -> {deleted:true}; later bearer calls -> 401, so a
 *    401 on a repeat delete means "already removed".
 *  - Every route: 503 while the backend is off, 401 for a missing/invalid bearer, 429 on quotas.
 * test-push and digests are not used by the client yet.
 */
import type { Follow } from "./follows";
import { fetchWithRetry, type On429, type RetryOptions } from "./retry";

export const NOTIFICATIONS_BACKEND_ENABLED = process.env.EXPO_PUBLIC_NOTIFICATIONS_BACKEND === "1";
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

export interface DeviceRegistration {
  deviceId: string;
  /** Bearer secret for this device's management calls. Kept in SecureStore, never logged. */
  secret: string;
}

export type ApiFailure =
  | { ok: false; kind: "disabled" } // 503: backend turned off; stay silent, keep local state
  | { ok: false; kind: "unauthorized" } // 401: the server doesn't know this secret
  | { ok: false; kind: "rate-limited" } // 429 that we will not (or no longer) retry: quotas are deterministic
  | { ok: false; kind: "conflict" } // 409 (defensive: current servers answer 201 and replace the old device)
  | { ok: false; kind: "network"; detail: string } // never got an answer, retries exhausted
  | { ok: false; kind: "error"; status: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/** The wire shape of the follow list. */
export const followsPayload = (follows: Follow[]) => ({
  follows: follows.map((f) => ({ kind: f.kind, symbol: f.symbol })),
});

export interface NotifyApi {
  /** Register (or, with an existing secret, authenticated-replace) this install's Expo push token. */
  subscribe(token: string, existingSecret?: string | null): Promise<ApiResult<DeviceRegistration>>;
  /** Atomically replace the follow list. */
  putFollows(secret: string, follows: Follow[]): Promise<ApiResult<null>>;
  /** Erase this device's data server-side. Idempotent: an already-gone device counts as success. */
  deleteDevice(secret: string): Promise<ApiResult<null>>;
}

export function createNotifyApi(fetchImpl: typeof fetch = fetch, retry: RetryOptions = {}, base = API_BASE): NotifyApi {
  async function call<T>(path: string, init: RequestInit, parse: (res: Response) => Promise<T>, on429: On429, okOn404 = false): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, `${base}${path}`, init, { ...retry, on429 });
    } catch (e) {
      return { ok: false, kind: "network", detail: e instanceof Error ? e.message : "network error" };
    }
    if (res.status === 503) return { ok: false, kind: "disabled" };
    if (res.status === 401) return { ok: false, kind: "unauthorized" };
    if (res.status === 409) return { ok: false, kind: "conflict" };
    if (res.status === 429) return { ok: false, kind: "rate-limited" };
    if (res.ok || (okOn404 && res.status === 404)) {
      try {
        return { ok: true, data: await parse(res) };
      } catch {
        return { ok: false, kind: "error", status: res.status };
      }
    }
    return { ok: false, kind: "error", status: res.status };
  }
  const json = { "Content-Type": "application/json" };
  const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });

  return {
    subscribe: (token, existingSecret) =>
      call(
        "/notifications/subscribe",
        { method: "POST", headers: { ...json, ...(existingSecret ? bearer(existingSecret) : {}) }, body: JSON.stringify({ transport: "expo", token }) },
        async (res) => {
          const v = (await res.json()) as Partial<DeviceRegistration>;
          if (typeof v.deviceId !== "string" || typeof v.secret !== "string") throw new Error("bad subscribe response");
          return { deviceId: v.deviceId, secret: v.secret };
        },
        "terminal", // enrolment quotas are deterministic: a retry only burns more of them
      ),
    putFollows: (secret, follows) =>
      call("/notifications/follows", { method: "PUT", headers: { ...json, ...bearer(secret) }, body: JSON.stringify(followsPayload(follows)) }, async () => null, "retry-after-once"),
    deleteDevice: (secret) =>
      call("/notifications/device", { method: "DELETE", headers: bearer(secret) }, async () => null, "retry-after-once", true),
  };
}
