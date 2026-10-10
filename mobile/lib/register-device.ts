/**
 * Client for the PLANNED notifications backend (see NOTIFICATIONS_DESIGN.md:
 * POST /notifications/subscribe, PUT /notifications/follows). The backend does
 * not exist yet, so everything here sits behind a feature flag that is OFF.
 * Turn it on with EXPO_PUBLIC_NOTIFICATIONS_BACKEND=1 once the API ships.
 */
import type { Follow } from "./follows";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

export const NOTIFICATIONS_BACKEND_ENABLED = process.env.EXPO_PUBLIC_NOTIFICATIONS_BACKEND === "1";

export interface DeviceRegistration {
  deviceId: string;
  /** Bearer secret for this device's management calls. Store in SecureStore, never log it. */
  secret: string;
}

export type RegisterResult =
  | { ok: true; registration: DeviceRegistration }
  | { ok: false; reason: "backend-disabled" | "error"; detail?: string };

/** The wire shape of the follow list the planned API accepts. */
export const followsPayload = (follows: Follow[]) => ({
  follows: follows.map((f) => ({ kind: f.kind, symbol: f.symbol })),
});

/** Register this install's Expo push token, then replace its follow list. Returns {ok:false} instead of throwing. */
export async function registerDevice(
  token: string,
  follows: Follow[],
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterResult> {
  if (!NOTIFICATIONS_BACKEND_ENABLED) return { ok: false, reason: "backend-disabled" };
  try {
    const res = await fetchImpl(`${API_BASE}/notifications/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transport: "expo", token }),
    });
    if (!res.ok) return { ok: false, reason: "error", detail: `subscribe ${res.status}` };
    const registration = (await res.json()) as DeviceRegistration;
    const put = await fetchImpl(`${API_BASE}/notifications/follows`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${registration.secret}` },
      body: JSON.stringify(followsPayload(follows)),
    });
    if (!put.ok) return { ok: false, reason: "error", detail: `follows ${put.status}` };
    return { ok: true, registration };
  } catch (e) {
    return { ok: false, reason: "error", detail: e instanceof Error ? e.message : "network error" };
  }
}
