"use server";

import { api } from "@/lib/api";
import { buildBroadcast } from "@/lib/brief";
import { getExperienceAccess } from "@/lib/whop-auth";
import { whopSdk } from "@/lib/whop-sdk";

export type BroadcastResult =
  | { ok: true; recipients: "members" }
  | { ok: false; error: string };

/** Push content has to stay short to render well on a lock screen. */
const MAX_NOTE = 160;

/**
 * Broadcast today's institutional brief to everyone in the experience as a
 * Whop push notification that deep-links back into the Signals tab.
 *
 * Authorization is enforced HERE, server-side — the composer is only shown to
 * admins, but we never trust that: a non-admin calling this directly is
 * rejected. Delivery is a single push to the whole experience, so there's no
 * per-community config to store.
 */
export async function broadcastBrief(
  experienceId: string,
  note: string,
): Promise<BroadcastResult> {
  const access = await getExperienceAccess(experienceId);
  if (!access) {
    return { ok: false, error: "Open this inside Whop to broadcast." };
  }
  if (access.accessLevel !== "admin") {
    return { ok: false, error: "Only community admins can broadcast the brief." };
  }

  const payload = await api.signals({ throwOnError: false });
  if (!payload) {
    return {
      ok: false,
      error: "Couldn't reach the TickerTrace API. Try again in a minute.",
    };
  }

  const brief = buildBroadcast(payload);
  if (brief.isEmpty) {
    return {
      ok: false,
      error: "No signals on the tape today — nothing worth broadcasting.",
    };
  }

  const content = note.trim().slice(0, MAX_NOTE) || brief.pushSummary;

  // A push notification carries exactly one tap target, so "each signal
  // deep-links" happens in the composer's preview (real links per ticker),
  // while the push itself opens the single most relevant one: today's top
  // mover. Falls back to the Signals tab when there's no single standout
  // (shouldn't happen once isEmpty is false, but stay defensive).
  const restPath = brief.topSignal
    ? `/ticker/${encodeURIComponent(brief.topSignal.ticker)}`
    : "?tab=signals";

  try {
    await whopSdk.notifications.sendPushNotification({
      experienceId,
      title: brief.pushTitle,
      content,
      // Whose avatar shows on the notification — the creator who sent it.
      senderUserId: access.userId,
      // Deep-link target. Requires the app's experience path to include
      // [restPath] in the Whop dashboard (e.g.
      // /experiences/[experienceId][restPath]); if that token isn't set,
      // Whop just opens the app's default view instead.
      restPath,
      isMention: false,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    return {
      ok: false,
      error: `Whop rejected the broadcast: ${detail}. Check that the app has the notification permission enabled.`,
    };
  }

  return { ok: true, recipients: "members" };
}
