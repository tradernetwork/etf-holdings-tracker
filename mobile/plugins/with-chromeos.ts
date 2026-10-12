import { withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";

type Manifest = {
  manifest: {
    "uses-feature"?: { $: Record<string, string> }[];
    application?: { activity?: { $: Record<string, string> }[] }[];
  };
};

/** Features that are only *implied required* when undeclared; a Chromebook may lack any of them. */
export const OPTIONAL_FEATURES = [
  "android.hardware.touchscreen",
  "android.hardware.screen.portrait",
  "android.hardware.screen.landscape",
];

/** Pure manifest transform (unit-tested): optional hardware + explicitly resizable activities. */
export function applyChromeOs(modResults: Manifest): Manifest {
  const m = modResults.manifest;
  const features = (m["uses-feature"] ??= []);
  for (const name of OPTIONAL_FEATURES) {
    const existing = features.find((f) => f.$["android:name"] === name);
    if (existing) existing.$["android:required"] = "false";
    else features.push({ $: { "android:name": name, "android:required": "false" } });
  }
  for (const app of m.application ?? []) {
    for (const act of app.activity ?? []) act.$["android:resizeableActivity"] = "true";
  }
  return modResults;
}

/**
 * ChromeOS readiness. Without an explicit touchscreen `required=false`, Play implies the feature is
 * required and hides the app from Chromebooks that have no touchscreen. Resizing is declared
 * explicitly so a future dependency can't silently lock the window size.
 */
const withChromeOs: ConfigPlugin = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults = applyChromeOs(c.modResults as unknown as Manifest) as unknown as typeof c.modResults;
    return c;
  });

export default withChromeOs;
