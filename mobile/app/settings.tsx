import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Card, Hint, Note, Screen, SectionHeader } from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { optInStatus } from "@/lib/notify";
import { fonts, MIN_TAP, radii, spacing, palettes, type Palette, type ThemeName, type ThemePreference } from "@/lib/theme";
import { useStyles, useTheme, useThemeControls } from "@/lib/theme-context";

const THEMES: { pref: ThemePreference; title: string; blurb: string }[] = [
  { pref: "auto", title: "Auto", blurb: "Match your phone: Terminal in dark mode, Paper in light mode." },
  { pref: "terminal", title: "Terminal", blurb: "Dark navy, built for night-time scanning." },
  { pref: "paper", title: "Paper", blurb: "Warm light paper with dark evidence cards." },
];

export default function Settings() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { themeName, preference, setPreference } = useThemeControls();
  const { notify, enableNotifications, disableNotifications, follows, clearFollows } = useAppState();
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <Screen topInset={false}>
      <SectionHeader title="Appearance" />
      {THEMES.map((t) => {
        const on = t.pref === preference;
        const dark = palettes.terminal;
        const light = palettes.paper;
        return (
          <Pressable key={t.pref} onPress={() => setPreference(t.pref)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Card style={[styles.themeCard, on && { borderColor: c.accent }]}>
              {t.pref === "auto" ? (
                <View style={[styles.swatch, { padding: 0, overflow: "hidden", flexDirection: "row", borderColor: c.border }]}>
                  <View style={{ flex: 1, backgroundColor: dark.canvas, padding: 6, justifyContent: "space-between" }}>
                    <View style={[styles.swatchCard, { backgroundColor: dark.heroBg }]} />
                    <View style={[styles.dot, { backgroundColor: dark.buy }]} />
                  </View>
                  <View style={{ flex: 1, backgroundColor: light.canvas, padding: 6, justifyContent: "space-between" }}>
                    <View style={[styles.swatchCard, { backgroundColor: light.heroBg }]} />
                    <View style={[styles.dot, { backgroundColor: light.buy }]} />
                  </View>
                </View>
              ) : (
                <View style={[styles.swatch, { backgroundColor: palettes[t.pref].canvas, borderColor: palettes[t.pref].border }]}>
                  <View style={[styles.swatchCard, { backgroundColor: palettes[t.pref].heroBg }]} />
                  <View style={{ flexDirection: "row", gap: 3 }}>
                    <View style={[styles.dot, { backgroundColor: palettes[t.pref].buy }]} />
                    <View style={[styles.dot, { backgroundColor: palettes[t.pref].sell }]} />
                  </View>
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{t.title}{t.pref === "auto" ? `  ·  now ${themeName === "paper" ? "Paper" : "Terminal"}` : ""}</Text>
                <Text style={styles.blurb}>{t.blurb}</Text>
              </View>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? c.accent : c.textMuted} />
            </Card>
          </Pressable>
        );
      })}
      <Note>Your choice is remembered on this device. Auto changes with your phone, for example at sunset.</Note>

      {Platform.OS !== "web" && (
        <>
          <SectionHeader title="Notifications" />
          <Card style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
              <Text style={styles.title}>Daily digest</Text>
              <Switch
                value={notify.enabled}
                onValueChange={(on) => (on ? void enableNotifications() : disableNotifications())}
                trackColor={{ true: c.accent, false: c.border }}
                accessibilityLabel="Daily digest notifications"
              />
            </View>
            <Text style={styles.blurb}>{optInStatus(notify)}</Text>
          </Card>
        </>
      )}

      <SectionHeader title="Your follows" />
      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.blurb}>
          {follows.length === 0 ? "You aren't following anything." : `${follows.length} followed, kept on this device only.`}
        </Text>
        {follows.length > 0 && (
          <Pressable
            onPress={() => {
              if (confirmClear) { clearFollows(); setConfirmClear(false); } else setConfirmClear(true);
            }}
            accessibilityRole="button"
            style={[styles.clear, confirmClear && { borderColor: c.sell }]}
          >
            <Text style={{ color: confirmClear ? c.sell : c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 14 }}>
              {confirmClear ? "Tap again to clear all follows" : "Clear my follows"}
            </Text>
          </Pressable>
        )}
      </Card>
      <Hint style={{ marginTop: spacing.lg }}>TickerTrace shows what institutions disclosed, not advice. Data comes from public fund holdings files.</Hint>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    themeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    clear: { minHeight: MIN_TAP, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border, borderRadius: radii.pill },
    swatch: { width: 56, height: 56, borderRadius: radii.md, borderWidth: 1, padding: 6, justifyContent: "space-between" },
    swatchCard: { height: 20, borderRadius: 5 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
    blurb: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
  });
