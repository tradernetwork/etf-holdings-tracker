import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, Hint, Note, Screen, SectionHeader } from "@/components/ui";
import { fonts, radii, spacing, palettes, type Palette, type ThemeName } from "@/lib/theme";
import { useStyles, useTheme, useThemeControls } from "@/lib/theme-context";

const THEMES: { name: ThemeName; title: string; blurb: string }[] = [
  { name: "terminal", title: "Terminal", blurb: "Dark navy, built for night-time scanning." },
  { name: "paper", title: "Paper", blurb: "Warm light paper with dark evidence cards." },
];

export default function Settings() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { themeName, setThemeName } = useThemeControls();
  return (
    <Screen topInset={false}>
      <SectionHeader title="Appearance" />
      {THEMES.map((t) => {
        const on = t.name === themeName;
        const p = palettes[t.name];
        return (
          <Pressable key={t.name} onPress={() => setThemeName(t.name)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Card style={[styles.themeCard, on && { borderColor: c.accent }]}>
              <View style={[styles.swatch, { backgroundColor: p.canvas, borderColor: p.border }]}>
                <View style={[styles.swatchCard, { backgroundColor: p.heroBg }]} />
                <View style={{ flexDirection: "row", gap: 3 }}>
                  <View style={[styles.dot, { backgroundColor: p.buy }]} />
                  <View style={[styles.dot, { backgroundColor: p.sell }]} />
                </View>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{t.title}</Text>
                <Text style={styles.blurb}>{t.blurb}</Text>
              </View>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? c.accent : c.textMuted} />
            </Card>
          </Pressable>
        );
      })}
      <Note>Your choice is remembered on this device.</Note>
      <Hint style={{ marginTop: spacing.lg }}>TickerTrace shows what institutions disclosed, not advice. Data comes from public fund holdings files.</Hint>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    themeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    swatch: { width: 56, height: 56, borderRadius: radii.md, borderWidth: 1, padding: 6, justifyContent: "space-between" },
    swatchCard: { height: 20, borderRadius: 5 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
    blurb: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
  });
