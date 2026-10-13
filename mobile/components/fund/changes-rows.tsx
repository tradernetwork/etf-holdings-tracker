import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Hint, Mono, Tappable } from "@/components/ui";
import { deltaOf } from "@/lib/fundChanges";
import { cleanName, formatShareMove, formatPp, formatShares, formatWeight, sectorLabel } from "@/lib/format";
import { deltaColor, fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { Change, FundStreak } from "@/lib/types";

/** One equity change: ticker, name · sector, previous → current weight, active Δ and share Δ (— when null/catch-up). */
export function ChangeRow({ ch }: { ch: Change }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const d = deltaOf(ch);
  return (
    <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(ch.ticker)}`)} style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.ticker}>{ch.ticker}</Text>
          {ch.type === "NEW" ? <Badge label="NEW" color={c.isNew} /> : null}
          {ch.type === "REMOVED" ? <Badge label="EXIT" color={c.sell} /> : null}
        </View>
        <Hint>{formatShareMove(ch.previousShares, ch.currentShares) ?? "Shares —"}</Hint>
        <Hint>{[cleanName(ch.name), ch.sector ? sectorLabel(ch.sector) : ""].filter(Boolean).join(" · ")}</Hint>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14, color: deltaColor(d, c) }}>{d === null ? "—" : formatPp(d)}</Mono>
        <Hint>{formatWeight(ch.previousWeight)} → {formatWeight(ch.currentWeight)}</Hint>
        {ch.sharesDelta != null && ch.sharesDelta !== 0 ? <Hint>{formatShares(ch.sharesDelta)} sh</Hint> : null}
      </View>
    </Tappable>
  );
}

/** Consecutive-day moves: "ARKK TSLA ▲ 5d". */
export function StreakRow({ s }: { s: FundStreak }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const up = s.direction === "up";
  return (
    <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(s.ticker)}`)} style={styles.row}>
      <Text style={[styles.ticker, { flex: 1 }]}>{s.ticker}</Text>
      <Mono bold style={{ color: up ? c.buy : c.sell, fontSize: 14 }}>{up ? "▲" : "▼"} {s.days}d</Mono>
      <Hint style={{ width: 64, textAlign: "right" }}>{up ? "accumulating" : "reducing"}</Hint>
    </Tappable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
    ticker: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
  });
