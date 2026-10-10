/**
 * Keeps the server's idea of this device in step with the app: register on
 * enable, push follow edits (debounced), delete on disable/clear, rotate on a
 * changed push token. Pure of React and of globals: every dependency is injected,
 * so the whole lifecycle is unit tested with a fake API, store and timers.
 *
 * Guarantees:
 *  - Flag off or web => nothing runs: no network, no storage.
 *  - 503 (backend disabled) => silent; local state is untouched.
 *  - 401 (secret unknown) => forget the secret, re-subscribe ONCE, retry the call once.
 *  - Network failures were already retried with backoff inside the API client.
 */
import type { Follow } from "./follows";
import type { DeviceStore, StoredDevice } from "./device-store";
import type { ApiFailure, ApiResult, DeviceRegistration, NotifyApi } from "./notifyApi";

export interface SyncDeps {
  api: NotifyApi;
  store: DeviceStore;
  enabled: boolean; // EXPO_PUBLIC_NOTIFICATIONS_BACKEND === "1"
  platform: string;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** Diagnostics for terminal failures. Must never be given secrets or tokens. */
  log?: (message: string) => void;
}

export type SyncOutcome = "skipped" | "synced" | "silent" | "failed";

export class NotifySync {
  private readonly debounceMs: number;
  private timer: unknown = null;
  private pending: { follows: Follow[]; token: string } | null = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;

  constructor(private readonly d: SyncDeps) {
    this.debounceMs = d.debounceMs ?? 2000;
    this.setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  private get active(): boolean {
    return this.d.enabled && this.d.platform !== "web";
  }

  /** Register (or re-register) with this token and push the follow list. */
  async onEnabled(token: string, follows: Follow[]): Promise<SyncOutcome> {
    if (!this.active) return "skipped";
    return this.ensureRegisteredAndPut(token, follows);
  }

  /** App launch: if the push token changed since registration, rotate it. */
  async onLaunch(token: string | null, follows: Follow[]): Promise<SyncOutcome> {
    if (!this.active || !token) return "skipped";
    const stored = await this.d.store.get();
    if (stored && stored.token === token) return "skipped";
    return this.ensureRegisteredAndPut(token, follows, stored);
  }

  /** A follow was added/removed: push the full list after a quiet period. */
  onFollowsChanged(follows: Follow[], token: string | null): void {
    if (!this.active || !token) return;
    this.pending = { follows, token };
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      void this.flush();
    }, this.debounceMs);
  }

  /** Send any debounced edit now (also used by tests and on app background). */
  async flush(): Promise<SyncOutcome> {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    if (!p || !this.active) return "skipped";
    return this.ensureRegisteredAndPut(p.token, p.follows, await this.d.store.get());
  }

  /** Notifications turned off, or follows cleared: delete the device server-side, then wipe the secret. */
  async onDisabled(): Promise<SyncOutcome> {
    if (!this.active) return "skipped";
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
    const stored = await this.d.store.get();
    if (!stored) return "skipped";
    const r = await this.d.api.deleteDevice(stored.secret);
    // A 401 means the server already forgot us: the goal (no registration) is met.
    if (r.ok || r.kind === "unauthorized") {
      await this.d.store.clear();
      return "synced";
    }
    // 503/network: keep the secret so a later attempt can still delete; local state is untouched.
    return r.kind === "disabled" || r.kind === "rate-limited" ? "silent" : "failed";
  }

  // ---- internals -----------------------------------------------------------

  private async ensureRegisteredAndPut(token: string, follows: Follow[], known?: StoredDevice | null): Promise<SyncOutcome> {
    let stored = known === undefined ? await this.d.store.get() : known;

    if (!stored || stored.token !== token) {
      const reg = await this.d.api.subscribe(token, stored?.secret ?? null);
      if (!reg.ok) return this.outcomeOf(reg);
      stored = await this.save(reg.data, token);
    }

    let put = await this.d.api.putFollows(stored.secret, follows);
    if (!put.ok && put.kind === "unauthorized") {
      // The server doesn't know this secret: re-subscribe ONCE and retry once.
      await this.d.store.clear();
      const reg = await this.d.api.subscribe(token, null);
      if (!reg.ok) return this.outcomeOf(reg);
      stored = await this.save(reg.data, token);
      put = await this.d.api.putFollows(stored.secret, follows);
    }
    return put.ok ? "synced" : this.outcomeOf(put);
  }

  private async save(reg: DeviceRegistration, token: string): Promise<StoredDevice> {
    const d = { deviceId: reg.deviceId, secret: reg.secret, token };
    await this.d.store.set(d);
    return d;
  }

  private outcomeOf(r: ApiResult<unknown> & ApiFailure): SyncOutcome {
    const log = this.d.log ?? (() => {});
    if (r.kind === "disabled") return "silent";
    // 429: quotas are deterministic, so we never hammer. Silent for the user, one line for developers.
    if (r.kind === "rate-limited") {
      log("notify: rate limited (429); not retrying");
      return "silent";
    }
    // 409 is defensive only (current servers answer 201 and replace the old device). Terminal: stay opted in locally, don't loop.
    if (r.kind === "conflict") log("notify: subscribe conflict (409); staying unregistered, local opt-in kept");
    // 422: the server rejected the follow list. Don't retry; local follows are kept.
    else if (r.kind === "error" && r.status === 422) log("notify: follows rejected (422); not retrying, local follows kept");
    else if (r.kind === "error") log(`notify: request failed (${r.status})`);
    else if (r.kind === "network") log("notify: network failure after retries");
    return "failed";
  }
}
