/**
 * Native-only push setup. Never imported on web (the opt-in is hidden there), and
 * expo-notifications is loaded lazily so the web bundle never evaluates it.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

export interface EnableOutcome {
  permission: "granted" | "denied";
  /** Expo push token, or null when we cannot mint one (no EAS projectId yet, or an error). */
  token: string | null;
}

/** The EAS project id, set after `eas init`. Unset today, so no token can be minted. */
export const easProjectId = (): string | null =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
  Constants.easConfig?.projectId ??
  null;

/**
 * Ask for notification permission (Android 13+ POST_NOTIFICATIONS) and, when an EAS
 * project exists, get the Expo push token. Only call this in response to the user
 * tapping Enable, never on launch.
 */
export async function requestEnable(): Promise<EnableOutcome> {
  if (Platform.OS === "web") return { permission: "denied", token: null };
  const N = await import("expo-notifications");
  if (Platform.OS === "android") {
    await N.setNotificationChannelAsync("digest", {
      name: "Daily digest",
      importance: N.AndroidImportance.DEFAULT,
    }).catch(() => {});
  }
  const existing = await N.getPermissionsAsync();
  let perm = existing.granted ? existing : await N.requestPermissionsAsync();
  // The prompt's own result can lag the real grant on Android; re-read before calling it a refusal.
  if (!perm.granted) perm = await N.getPermissionsAsync().catch(() => perm);
  if (!perm.granted) return { permission: "denied", token: null };

  const projectId = easProjectId();
  if (!projectId) return { permission: "granted", token: null };
  try {
    const t = await N.getExpoPushTokenAsync({ projectId });
    return { permission: "granted", token: t.data };
  } catch {
    return { permission: "granted", token: null };
  }
}

/** Current OS notification permission, without prompting. null where it cannot be known (web, errors). */
export async function readPermissionGranted(): Promise<boolean | null> {
  if (Platform.OS === "web") return null;
  try {
    const N = await import("expo-notifications");
    return (await N.getPermissionsAsync()).granted;
  } catch {
    return null;
  }
}

/**
 * The current Expo push token WITHOUT prompting: only when permission is already
 * granted and an EAS project exists. Used on launch to notice token rotation.
 */
export async function currentPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const projectId = easProjectId();
  if (!projectId) return null;
  try {
    const N = await import("expo-notifications");
    if (!(await N.getPermissionsAsync()).granted) return null;
    return (await N.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}
