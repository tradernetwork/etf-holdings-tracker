import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Badge, Hint, Mono } from "@/components/ui";
import { optionSubtitle, optionTitle } from "@/lib/book";
import { expiryInfo } from "@/lib/expiry";
import { cleanName, formatPp, formatQty, formatShares, formatUsd, formatWeight } from "@/lib/format";
import { rowType, type RowType } from "@/lib/holdingsBrowser";
import { deltaColor, fonts, MIN_TAP, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import { shortDay } from "@/lib/expiry";
import type { HoldingRow } from "@/lib/types";

const TYPE_TONE: Record<RowType, "accent" | "buy" | "sell" | "muted"> = { STOCK: "muted", CALL: "buy", PUT: "sell", CASH: "muted", "T-BILL": "muted", SWAP: "muted", OTHER: "muted" };

const isCatchUp = (r: HoldingRow): boolean => r.catchUpSince !== undefined && r.catchUpSince !== null;

/** One raw book row: fund, ticker, type, value, weight and the changes; tap for every other field of the row. */
export function HoldingCard({ r }: { r: HoldingRow }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const type = rowType(r);
  const tone = TYPE_TONE[type];
  const color = tone === "buy" ? c.buy : tone === "sell" ? c.sell : c.textMuted;
  const option = r.isOption;
  const qty = r.contracts ?? r.shares;
  const catchUp = isCatchUp(r);
  const exp = option ? expiryInfo({ expiry: r.expiry, asOf: r.fileDate, fileDte: r.dte }) : null;
  const title = option ? optionTitle(r.underlying ?? r.ticker, r.optionType, r.strike) : r.ticker;
  const value = r.marketValue ?? r.positionUsd ?? null;
  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.line}>
            <Pressable onPress={() => router.push(`/fund/${encodeURIComponent(r.fund)}`)} accessibilityRole="link" hitSlop={6}>
              <Text style={styles.fund}>{r.fund}</Text>
            </Pressable>
            <Pressable onPress={() => router.push(`/ticker/${encodeURIComponent(option ? r.underlying ?? r.ticker : r.ticker)}`)} accessibilityRole="link" hitSlop={6} style={{ flexShrink: 1 }}>
              <Text style={styles.ticker} numberOfLines={1}>{title}</Text>
            </Pressable>
            <Badge label={type} color={color} />
            {option && r.isFlex ? <Badge label="FLEX" color={c.textMuted} /> : null}
          </View>
          <Hint>{option ? optionSubtitle(r.expiry, r.dte, false, r.fileDate) : cleanName(r.name)}</Hint>
          <View style={styles.line}>
            <Text style={[styles.mono, { color: qty != null && qty < 0 ? c.sell : c.textSecondary }]}>{qty == null ? "—" : `${formatQty(qty)}${option ? " ct" : " sh"}`}</Text>
            <Text style={[styles.mono, { color: catchUp || !r.sharesDelta ? c.textMuted : deltaColor(r.sharesDelta, c) }]}>
              Δ{catchUp || r.sharesDelta == null ? " —" : r.sharesDelta === 0 ? " 0" : ` ${formatShares(r.sharesDelta)}`}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Mono bold style={{ fontSize: 14, color: value != null && value < 0 ? c.isNew : c.textPrimary }}>{value == null ? "—" : formatUsd(value)}</Mono>
          <Hint>{formatWeight(r.weight)}</Hint>
          <Text style={[styles.mono, { color: catchUp || r.activeWeightDelta == null ? c.textMuted : deltaColor(r.activeWeightDelta, c) }]}>
            {catchUp || r.activeWeightDelta == null ? "Δ —" : formatPp(r.activeWeightDelta)}
          </Text>
        </View>
      </Pressable>
      {open && (
        <View style={styles.more}>
          <Field label="Raw Δ weight" value={catchUp || r.weightDelta == null ? "—" : formatPp(r.weightDelta)} />
          <Field label="Active Δ weight" value={catchUp || r.activeWeightDelta == null ? "—" : formatPp(r.activeWeightDelta)} />
          <Field label="Δ shares" value={catchUp || r.sharesDelta == null ? "—" : formatShares(r.sharesDelta)} />
          <Field label="Weight" value={`${r.weight.toFixed(3)}%`} />
          <Field label="Market value" value={r.marketValue == null ? "—" : `$${Math.round(r.marketValue).toLocaleString("en-US")}`} />
          {option && (
            <>
              <Field label="Strike" value={r.strike == null ? "—" : r.strike.toFixed(2)} />
              <Field label="Expiry" value={r.expiry ?? "—"} />
              <Field label="DTE in file" value={r.dte == null ? "—" : String(Math.round(r.dte))} />
              <Field label="Today" value={exp?.label || "—"} />
            </>
          )}
          <Field label="Asset class" value={r.assetClass ?? "—"} />
          <Field label="File" value={`${r.fileDate ?? "—"}${r.stale ? " · older disclosure" : ""}${r.refreshed === false ? " · carried forward" : ""}`} />
          {catchUp ? <Hint>Catch-up since {shortDay(r.catchUpSince) || "an earlier file"}: the previous file was carried forward, so no one-day change is shown.</Hint> : null}
        </View>
      )}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Mono style={{ fontSize: 12 }}>{value}</Mono>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { borderBottomColor: c.border, borderBottomWidth: 1 },
    row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md, minHeight: MIN_TAP + 10 },
    line: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
    fund: { color: c.accent, fontFamily: fonts.bodyBold, fontSize: 13 },
    ticker: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    mono: { fontFamily: fonts.mono, fontSize: 11 },
    more: { paddingBottom: spacing.md, gap: 4 },
    field: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
    fieldLabel: { color: c.textMuted, fontFamily: fonts.body, fontSize: 12 },
  });
