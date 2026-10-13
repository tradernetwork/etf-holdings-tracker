import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, Hint, Mono } from "@/components/ui";
import {
  valueText, type AllocKey, type Book, type Bucket, type OptionGroup, type SortKey, type StockLine,
} from "@/lib/book";
import { cleanName, formatCount, formatPp, formatShares, formatUsd, formatWeight } from "@/lib/format";
import { deltaColor, display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/**
 * Reusable brokerage-style rows, shared by the fund screen and (next) the income directory and the
 * ticker screen's option holders: stock rows, option-leg rows, bucket rows, allocation bar, banners.
 */

// ---- pieces ---------------------------------------------------------------------

export function FreshLine({ text, stale }: { text: string; stale: boolean }) {
  const c = useTheme();
  if (!text) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {stale && <Ionicons name="time-outline" size={12} color={c.stale} />}
      <Text style={{ color: c.stale, fontSize: 11, fontFamily: fonts.body }}>{text}</Text>
    </View>
  );
}

export function Banner({ title, body }: { title: string; body: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.warn}>
      <Ionicons name="time-outline" size={20} color={c.warnText} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.warnTitle}>{title}</Text>
        <Text style={styles.warnBody}>{body}</Text>
      </View>
    </View>
  );
}

export function FollowButton({ symbol, following, onToggle }: { symbol: string; following: boolean; onToggle: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${following ? "Unfollow" : "Follow"} ${symbol}`}
      accessibilityState={{ selected: following }}
      style={[styles.follow, following && { backgroundColor: c.accent + "22", borderColor: c.accent }]}
    >
      <Ionicons name={following ? "star" : "star-outline"} size={15} color={following ? c.accent : c.textSecondary} />
      <Text style={[styles.followText, following && { color: c.accent }]}>{following ? "Following" : "Follow"}</Text>
    </Pressable>
  );
}

export function segColor(key: AllocKey, c: Palette): string {
  return { stocks: c.accent, optionsLong: c.buy, optionsShort: c.isNew, treasury: c.textSecondary, cash: c.textMuted, swap: c.sell }[key];
}

export function AllocationBar({ book, onPress }: { book: Book; onPress: (k: AllocKey) => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const total = book.allocation.reduce((a, s) => a + Math.abs(s.weight), 0);
  if (total <= 0) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.cardTitle}>Allocation</Text>
      <View style={styles.bar} accessibilityRole="image" accessibilityLabel="Allocation by position type">
        {book.allocation.map((s) => (
          <Pressable key={s.key} onPress={() => onPress(s.key)} accessibilityRole="button" accessibilityLabel={`${s.label} ${formatWeight(s.weight)}`} style={{ flex: Math.max(Math.abs(s.weight) / total, 0.01), backgroundColor: segColor(s.key, c) }} />
        ))}
      </View>
      <View style={styles.legend}>
        {book.allocation.map((s) => (
          <Pressable key={s.key} onPress={() => onPress(s.key)} accessibilityRole="button" style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: segColor(s.key, c) }]} />
            <Text style={styles.legendText}>{s.label}</Text>
            <Mono style={{ fontSize: 12, color: s.weight < 0 ? c.isNew : c.textPrimary }}>{formatWeight(s.weight)}</Mono>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

export function SortChips({ value, onChange, options }: { value: SortKey; onChange: (k: SortKey) => void; options: { value: SortKey; label: string }[] }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.sortRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.sortChip, on && { backgroundColor: c.border }]}>
            <Text style={[styles.sortText, on && { color: c.textPrimary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StockRow({ line }: { line: StockLine }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const known = line.sharesDelta !== null || line.activeDelta !== null;
  const color = deltaColor(line.activeDelta ?? line.sharesDelta, c);
  return (
    <Pressable onPress={() => router.push(`/ticker/${encodeURIComponent(line.ticker)}`)} accessibilityRole="button" style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{line.ticker}</Text>
        <Hint>{`${line.shares < 0 ? "−" : ""}${formatCount(line.shares)} shares`}</Hint>
        {line.shares !== 0 ? <Hint style={{ opacity: 0.8 }}>{line.name}</Hint> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14 }}>{valueText(line.value)}</Mono>
        <Hint>{formatWeight(line.weight)} of fund</Hint>
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: known ? color : c.textMuted }}>
          {known ? [line.sharesDelta !== null && line.sharesDelta !== 0 ? `${formatShares(line.sharesDelta)} sh` : null, line.activeDelta !== null && line.activeDelta !== 0 ? formatPp(line.activeDelta) : null].filter(Boolean).join(" · ") || "no change" : "—"}
        </Text>
      </View>
    </Pressable>
  );
}

export function MoreRow({ total, open, onPress, noun = "stocks" }: { total: number; open: boolean; onPress: () => void; noun?: string }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: MIN_TAP, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>{open ? "Show fewer" : `Show all ${formatCount(total)} ${noun}`}</Text>
    </Pressable>
  );
}

export function OptionGroupHeader({ group }: { group: OptionGroup }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.groupHead}>
      <Text style={styles.groupTitle}>{group.underlying}</Text>
      <Hint>{group.lines.length} {group.lines.length === 1 ? "leg" : "legs"}{group.underlyingPrice !== null ? ` · last $${group.underlyingPrice.toFixed(2)}` : ""}</Hint>
      <View style={{ flex: 1 }} />
      <Mono bold style={{ fontSize: 13 }}>{group.valueUsd === null ? "—" : formatUsd(group.valueUsd)}</Mono>
      <Hint style={{ width: 62, textAlign: "right" }}>{formatWeight(group.weight)}</Hint>
    </View>
  );
}

export { OptionRow } from "@/components/fund/option-row";

export function ActivityBox({ lines }: { lines: string[] }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.activity}>
      <Text style={styles.cardTitle}>Activity</Text>
      {lines.slice(0, 5).map((l) => <Text key={l} style={styles.activityLine}>{l}</Text>)}
    </View>
  );
}

export function BucketRow({ bucket, open, onPress }: { bucket: Bucket; open: boolean; onPress: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{bucket.label}</Text>
        <Hint>{bucket.lines.length} {bucket.lines.length === 1 ? "line" : "lines"}</Hint>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14 }}>{bucket.valueUsd === null ? "—" : formatUsd(bucket.valueUsd)}</Mono>
        <Hint>{formatWeight(bucket.weight)} of fund</Hint>
      </View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
    </Pressable>
  );
}

export function BucketLineRow({ name, valueText: v, weight }: { name: string; valueText: string; weight: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.bline}>
      <Text style={styles.blineName} numberOfLines={1}>{name}</Text>
      <Mono style={{ fontSize: 12 }}>{v}</Mono>
      <Hint style={{ width: 56, textAlign: "right" }}>{formatWeight(weight)}</Hint>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.canvas },
    eyebrow: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4 },
    symbol: { ...display, color: c.textPrimary, fontSize: 48, lineHeight: 52, marginTop: spacing.xs },
    provider: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    total: { ...display, color: c.textPrimary, fontSize: 28, letterSpacing: -1 },
    follow: {
      flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: MIN_TAP, paddingHorizontal: spacing.md,
      borderWidth: 1, borderColor: c.border, borderRadius: radii.pill, backgroundColor: c.card,
    },
    followText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
    warn: { flexDirection: "row", gap: spacing.md, backgroundColor: c.warnBg, borderColor: c.warnBorder, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg },
    warnTitle: { color: c.warnText, fontFamily: fonts.bodyBold, fontSize: 14 },
    warnBody: { color: c.warnText, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
    cardTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 },
    bar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2, backgroundColor: c.border },
    legend: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: 2 },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
    legendText: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.xs, backgroundColor: c.canvas },
    sectionTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18 },
    sortRow: { flexDirection: "row", gap: 2 },
    sortChip: { minHeight: 32, paddingHorizontal: 10, justifyContent: "center", borderRadius: radii.pill },
    sortText: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomColor: c.border, borderBottomWidth: 1, minHeight: MIN_TAP + 10 },
    rowTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
    groupHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs, borderBottomColor: c.border, borderBottomWidth: 1 },
    groupTitle: { ...display, color: c.textPrimary, fontSize: 20, letterSpacing: -0.5 },
    activity: { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg, gap: 4, marginTop: spacing.md },
    activityLine: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    bline: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingLeft: spacing.md, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
    blineName: { flex: 1, color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  });
