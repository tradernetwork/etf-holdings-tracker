import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Badge, Card, Hint, Mono } from "@/components/ui";
import { describeTrade, dayStatus, formatDay, legChange } from "@/lib/activity";
import { tradeDirection } from "@/lib/discovery/derive";
import { formatCount } from "@/lib/format";
import type { OptionActivityDay, OptionTrade } from "@/lib/fundExtras";
import { fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { Change, OptionRoll } from "@/lib/types";

function toneColor(tone: string, c: Palette): string {
  switch (tone) {
    case "roll": return c.accent;
    case "spread": case "open": case "add": return c.buy;
    case "collar": return c.buy;
    case "flip": return c.isNew;
    case "synthetic": return c.textSecondary;
    default: return c.textMuted;
  }
}

/** A day of dated option trades: header ("Fri, Oct 9 · vs Thu, Oct 8 · 16 trades"), then each trade. */
export function DayHeader({ d }: { d: OptionActivityDay }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.dayHead}>
      <Text style={styles.day}>{formatDay(d.date)}</Text>
      <Hint>vs {formatDay(d.compareDate)}</Hint>
      <View style={{ flex: 1 }} />
      <Hint>{dayStatus(d)}</Hint>
    </View>
  );
}

export function TradeRow({ t }: { t: OptionTrade }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const x = describeTrade(t);
  return (
    <View style={styles.trade}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Badge label={x.badge.toUpperCase()} color={toneColor(x.tone, c)} />
        <Pressable onPress={() => router.push(`/ticker/${encodeURIComponent(t.underlying)}`)} hitSlop={6} accessibilityRole="link">
          <Mono bold style={{ fontSize: 14, color: c.accent }}>{t.underlying}</Mono>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Mono style={{ fontSize: 12, color: c.textSecondary }}>{formatCount(t.size)} ct</Mono>
      </View>
      <Text style={styles.tradeText}>{x.text}</Text>
      {t.legs.map((l, i) => (
        <Text key={i} style={[styles.legLine, { color: l.change < 0 ? c.isNew : c.buy }]}>{legChange(l)}</Text>
      ))}
    </View>
  );
}

export function ActivityNote() {
  return (
    <Hint style={{ marginTop: spacing.md }}>
      Built from contract counts, not weights: a price move can&apos;t show up as a trade. Changes of equal size on the same stock are paired: a roll closes one expiry and opens the next, a synthetic (long call + written put at one strike) is stock exposure, not two bets. Negative = written.
    </Hint>
  );
}

/** Fallback when the dated timeline is unavailable: positions rolled, not closed. */
export function RollCard({ roll }: { roll: OptionRoll }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const call = (roll.optionType || "").toLowerCase().startsWith("c");
  const fmt = (l: { strike: number; expiry: string }) => `${call ? "C" : "P"}$${l.strike}${l.expiry ? ` · ${l.expiry}` : ""}`;
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Mono bold style={{ fontSize: 15 }}>{roll.underlying}</Mono>
        <Hint>{call ? "Covered call" : "Cash-secured put"}</Hint>
      </View>
      <Text style={[styles.legLine, { color: c.textMuted, textDecorationLine: "line-through" }]}>{roll.closed.map(fmt).join("   ")}</Text>
      <Text style={[styles.legLine, { color: c.accent }]}>→ {roll.opened.map(fmt).join("   ")}</Text>
    </Card>
  );
}

/** Option contract changes today (the website's "Option Activity" list): opened / closed / added / trimmed. */
export function OptionChangeRow({ ch }: { ch: Change }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const d = (ch as Change & { optionDetails?: { type: string; strike: number; expiry: string } }).optionDetails;
  // Contracts, not weight: a written leg's count is the trade (API `direction`); raw weight moves with premium.
  const dir = tradeDirection(ch);
  const label = ch.type === "NEW" ? { t: "OPENED", color: c.accent } : ch.type === "REMOVED" ? { t: "CLOSED", color: c.textMuted } : dir === "buying" ? { t: "ADDED", color: c.buy } : dir === "selling" ? { t: "TRIMMED", color: c.sell } : { t: "CHANGED", color: c.textMuted };
  const name = d ? `${ch.ticker.split(" ")[0]} ${d.type.toLowerCase().startsWith("c") ? "C" : "P"}${d.strike}` : ch.ticker;
  return (
    <View style={styles.optChange}>
      <View style={{ flex: 1 }}>
        <Mono bold style={{ fontSize: 13, textDecorationLine: ch.type === "REMOVED" ? "line-through" : "none", color: ch.type === "REMOVED" ? c.textMuted : c.textPrimary }}>{name}</Mono>
        {d?.expiry ? <Hint>exp {d.expiry}</Hint> : null}
      </View>
      <Badge label={label.t} color={label.color} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    dayHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.xs, borderBottomColor: c.border, borderBottomWidth: 1 },
    day: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 },
    trade: { paddingVertical: spacing.sm, gap: 3, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
    tradeText: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    legLine: { fontFamily: fonts.mono, fontSize: 11 },
    optChange: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
  });
