/**
 * Notification opt-in as a small state machine, kept pure so every path is testable.
 *
 * Rules (from the product brief):
 *  - Never ask on launch. The prompt appears once, after the user's FIRST follow.
 *  - "Not now" is final for the prompt; the Settings toggle remains the way in.
 *  - Push needs an EAS projectId, which does not exist until `eas init`. Without
 *    one we record the preference and say notifications turn on in the store build.
 *  - No push on web.
 */
export interface OptInState {
  /** The one-time prompt has been answered (or skipped). */
  asked: boolean;
  /** The user wants digests. */
  enabled: boolean;
  /** The OS refused the permission. */
  denied: boolean;
  /** Preference saved but no push token could be minted yet (no EAS project). */
  awaitingBuild: boolean;
  /** Expo push token, when one exists. */
  token: string | null;
}

export const initialOptIn: OptInState = { asked: false, enabled: false, denied: false, awaitingBuild: false, token: null };

export type OptInEvent =
  | { type: "not-now" }
  | { type: "enable-result"; permission: "granted" | "denied"; token?: string | null }
  | { type: "disable" }
  /** The OS permission was re-read (after the prompt closed, or the app came back to the foreground). */
  | { type: "permission-sync"; granted: boolean };

export function reduceOptIn(s: OptInState, e: OptInEvent): OptInState {
  switch (e.type) {
    case "not-now":
      return { ...s, asked: true };
    case "permission-sync":
      // Granted: any "blocked" flag is stale (the OS prompt resolved late, or the user fixed it in system settings).
      if (e.granted) return s.denied ? { ...s, denied: false } : s;
      // Not granted while digests were on: the user revoked it outside the app.
      return s.enabled ? { ...s, enabled: false, denied: true, awaitingBuild: false } : s;
    case "disable":
      return { ...s, asked: true, enabled: false, awaitingBuild: false };
    case "enable-result":
      if (e.permission === "denied") return { ...s, asked: true, enabled: false, denied: true, awaitingBuild: false };
      return { ...s, asked: true, enabled: true, denied: false, token: e.token ?? null, awaitingBuild: !e.token };
  }
}

/** Show the one-time sheet right after a follow was ADDED, never on launch. */
export function shouldPrompt(s: OptInState, opts: { justAdded: boolean; followCount: number; platform: string }): boolean {
  return opts.justAdded && opts.followCount >= 1 && !s.asked && opts.platform !== "web";
}

export function parseOptIn(raw: string | null | undefined): OptInState {
  if (!raw) return initialOptIn;
  try {
    const v = JSON.parse(raw) as Partial<OptInState>;
    return {
      asked: v.asked === true,
      enabled: v.enabled === true,
      denied: v.denied === true,
      awaitingBuild: v.awaitingBuild === true,
      token: typeof v.token === "string" ? v.token : null,
    };
  } catch {
    return initialOptIn;
  }
}

/** One-line status for Settings. */
export function optInStatus(s: OptInState, followCount?: number): string {
  if (s.denied) return "Notifications are blocked in system settings.";
  const noFollows = s.enabled && followCount === 0;
  const first = "Follow a stock or fund to get your first digest.";
  if (s.enabled && s.awaitingBuild) return `Notifications will turn on in the store build.${noFollows ? ` ${first}` : ""}`;
  if (noFollows) return first;
  if (s.enabled) return "You'll get a daily digest when funds move your follows.";
  return "Off. Turn on to get a daily digest when funds move your follows.";
}
