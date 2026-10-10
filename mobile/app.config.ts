import type { ExpoConfig } from "expo/config";

// Dark-first: TickerTrace has one look (the dashboard's navy canvas), so the
// app is locked to dark rather than following the system scheme.
const BG = "#0a0f1e";

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
  userInterfaceStyle: "dark",
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
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      { image: "./assets/icon.png", imageWidth: 200, backgroundColor: BG },
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
