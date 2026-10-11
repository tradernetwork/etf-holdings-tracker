import { Ionicons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Hint, Mono } from "@/components/ui";
import { fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** "View all 42 ↗" style link. Real navigation target, never a dead label. */
export function ViewAll({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: "center" }}>
      <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 12 }}>{label} ↗</Text>
    </Pressable>
  );
}

/** Expands a capped list in place: "Show all 38" / "Show fewer". */
export function ShowMore({ total, shown, open, onPress }: { total: number; shown: number; open: boolean; onPress: () => void }) {
  const c = useTheme();
  if (total <= shown && !open) return null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 13 }}>{open ? "Show fewer" : `Show all ${total}`}</Text>
    </Pressable>
  );
}

export function TotalTile({ icon, value, label, blurb }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string; blurb: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.tile}>
      <Ionicons name={icon} size={18} color={c.accent} />
      <Mono bold style={{ fontSize: 24 }}>{value.toLocaleString("en-US")}</Mono>
      <Text style={styles.tileLabel}>{label}</Text>
      <Hint style={{ lineHeight: 15 }}>{blurb}</Hint>
    </View>
  );
}

/** A tappable chip: filter option or ticker. */
export function Chip({ label, on, onPress, color }: { label: string; on?: boolean; onPress: () => void; color?: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const tint = color ?? c.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[styles.chip, on && { backgroundColor: tint + "22", borderColor: tint }]}
    >
      <Text style={[styles.chipText, on && { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>{children}</View>;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    tile: { flex: 1, minWidth: 140, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.md, gap: 3 },
    tileLabel: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 13 },
    chip: { minHeight: 32, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, justifyContent: "center" },
    chipText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 12 },
  });
