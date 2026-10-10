import type { ExpoConfig } from "expo/config";

// Two looks, chosen in Settings: Terminal (dark navy) and Paper (warm light). The default is
// Auto, which follows the phone, so the app must report the system scheme ("automatic").
// BG is only the native root/splash colour; the app re-sets it from the active palette at runtime.
const BG = "#080D18"; // Terminal canvas
const BG_PAPER = "#F6F5EF"; // Paper canvas

const config: ExpoConfig = {
  name: "TickerTrace",
  slug: "tickertrace",
  scheme: "tickertrace",
  version: "0.1.0",
  // Binary-pinned: an OTA update only reaches builds with the same app version.
  runtimeVersion: { policy: "appVersion" },
  // Portrait phones are the target, but we deliberately do NOT lock
  // orientation: wide data tables are far more usable in landscape, and tablets
  // should get the same app. Revisit once real screens exist.
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: BG,
  ios: { supportsTablet: true },
  android: {
    // Must match the existing Play listing (currently a Chrome TWA).
    package: "pro.tickertrace.app",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: BG,
    },
    // No ads, no ad SDKs (funnel-guard): keep the advertising-ID permission out
    // even if a transitive dependency tries to add it.
    blockedPermissions: ["com.google.android.gms.permission.AD_ID"],
  },
  // Web is for previews only (react-native-web). Single-page output; set
  // EXPO_BASE_URL (e.g. /previews/app) when hosting under a sub-path.
  web: { bundler: "metro", output: "single", backgroundColor: BG },
  experiments: process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {},
  plugins: [
    "expo-router",
    // Local/push notifications (daily digest). Android 13+ POST_NOTIFICATIONS is requested at runtime, after an explicit opt-in.
    "expo-notifications",
    [
      "expo-splash-screen",
      {
        image: "./assets/icon.png",
        imageWidth: 200,
        // Splash matches the phone: light by default (Paper), dark when the phone is dark (Terminal).
        backgroundColor: BG_PAPER,
        dark: { image: "./assets/icon.png", backgroundColor: BG },
      },
    ],
  ],
  extra: {
    eas: {
      // TODO: set after `eas init` / `eas project:init` (needs the owner's Expo
      // account). Intentionally unset: do not create the project from CI.
      // projectId: "<uuid>",
    },
  },
  // TODO: add `updates: { url: "https://u.expo.dev/<projectId>" }` together with
  // the expo-updates package once the EAS project exists (see mobile/README.md).
};

export default config;
