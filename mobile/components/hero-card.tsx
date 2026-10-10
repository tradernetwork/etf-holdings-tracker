import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Tappable } from "@/components/ui";
import { cleanName, formatPp, sectorLabel } from "@/lib/format";
import type { HeroStory } from "@/lib/derive";
import { display, fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** The Home hero: ONE dark evidence card for the top story, per the Codex mockup. */
export function HeroCard({ story }: { story: HeroStory }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const eyebrow = story.countercase ? "ALLOCATION INCREASED · WITH A COUNTERCASE" : "ALLOCATION INCREASED";
  const sub = [cleanName(story.name), sectorLabel(story.sector)].filter(Boolean).join(" · ");
  const rows = [
    ...story.added.map((r) => ({ ...r, verb: "added", color: c.heroBuy })),
    ...story.reduced.map((r) => ({ ...r, verb: "reduced", color: c.heroSell })),
  ];
  return (
    <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(story.ticker)}`)} style={styles.card}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.symbol}>{story.ticker}</Text>
      <Text style={styles.sub} numberOfLines={2}>{sub}</Text>
      <View style={{ marginTop: spacing.sm }}>
        {rows.map((r) => (
          <View key={r.fund + r.verb} style={styles.row}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[styles.dot, { backgroundColor: r.color }]} />
              <Text style={styles.rowText}>{r.fund} {r.verb}</Text>
            </View>
            <Text style={[styles.rowValue, { color: r.color }]}>{formatPp(r.delta)}</Text>
          </View>
        ))}
      </View>
      <View style={styles.footer}>
        {story.streak ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>{story.streak.days}-session {story.streak.direction === "buying" ? "buying" : "selling"} streak</Text>
          </View>
        ) : <View />}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={styles.link}>See the evidence</Text>
          <Ionicons name="arrow-forward" size={13} color={c.heroMuted} />
        </View>
      </View>
    </Tappable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.heroBg, borderColor: c.heroBorder, borderWidth: 1, borderRadius: radii.hero, padding: spacing.xl },
    eyebrow: { color: c.heroMuted, fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.1 },
    symbol: { ...display, color: c.heroText, fontSize: 52, lineHeight: 58, marginTop: spacing.sm },
    sub: { color: c.heroMuted, fontFamily: fonts.body, fontSize: 14 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, borderTopColor: c.heroBorder, borderTopWidth: 1 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    rowText: { color: c.heroText, fontFamily: fonts.body, fontSize: 14 },
    rowValue: { fontFamily: fonts.monoBold, fontSize: 18 },
    footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
    chip: { backgroundColor: c.heroChip, borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 4 },
    chipText: { color: c.heroMuted, fontFamily: fonts.bodyBold, fontSize: 11 },
    link: { color: c.heroMuted, fontFamily: fonts.bodyMedium, fontSize: 12 },
  });
