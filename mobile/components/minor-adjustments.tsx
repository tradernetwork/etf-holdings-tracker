import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Mono } from "@/components/ui";
import { formatPp, formatWeight } from "@/lib/format";
import { deltaColor, fonts, MIN_TAP, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { Change } from "@/lib/types";

/**
 * Muted "+N smaller adjustments" row that expands on tap. These are changes below the
 * API's significance threshold: real, but noise next to the moves above them.
 */
export function MinorAdjustments({ rows, labelKey }: { rows: Change[]; labelKey: "fund" | "ticker" }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <View>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.head}>
        <Text style={styles.headText}>+{rows.length} smaller {rows.length === 1 ? "adjustment" : "adjustments"}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={c.textMuted} />
      </Pressable>
      {open &&
        rows.map((r) => (
          <View key={r.fund + r.ticker + r.type} style={styles.row}>
            <Text style={styles.label}>{r[labelKey]}</Text>
            <Text style={styles.weights}>{formatWeight(r.previousWeight)} → {formatWeight(r.currentWeight)}</Text>
            <Mono style={{ fontSize: 12, color: deltaColor(r.activeWeightDelta, c), width: 84, textAlign: "right" }}>{formatPp(r.activeWeightDelta)}</Mono>
          </View>
        ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: MIN_TAP },
    headText: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 13 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 32 },
    label: { color: c.textSecondary, fontFamily: fonts.monoBold, fontSize: 12, width: 64 },
    weights: { flex: 1, color: c.textMuted, fontFamily: fonts.body, fontSize: 12 },
  });
