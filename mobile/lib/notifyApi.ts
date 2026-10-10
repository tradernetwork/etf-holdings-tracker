/**
 * The ONLY module that knows the notifications wire shapes (paths, bodies,
 * headers, status meanings). Planned contract: docs/NOTIFICATIONS_DESIGN.md;
 * adjust here when the final "Client contract" lands, nothing else changes.
 */
import type { Follow } from "./follows";
import { fetchWithRetry, type RetryOptions } from "./retry";

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
  async function call<T>(path: string, init: RequestInit, parse: (res: Response) => Promise<T>, okOn404 = false): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetchWithRetry(fetchImpl, `${base}${path}`, init, retry);
    } catch (e) {
      return { ok: false, kind: "network", detail: e instanceof Error ? e.message : "network error" };
    }
    if (res.status === 503) return { ok: false, kind: "disabled" };
    if (res.status === 401) return { ok: false, kind: "unauthorized" };
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
      ),
    putFollows: (secret, follows) =>
      call("/notifications/follows", { method: "PUT", headers: { ...json, ...bearer(secret) }, body: JSON.stringify(followsPayload(follows)) }, async () => null),
    deleteDevice: (secret) =>
      call("/notifications/device", { method: "DELETE", headers: bearer(secret) }, async () => null, true),
  };
}
