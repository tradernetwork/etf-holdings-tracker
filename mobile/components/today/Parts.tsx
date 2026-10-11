import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Badge, Card, Hint, Mono, Tappable } from "@/components/ui";
import { cleanName, formatPp, formatUsd, sectorShort } from "@/lib/format";
import { convText, fundPositionUsd, signalStreak, signalSummary, streakLabel, strengthText, usdOrDash, type Kpi } from "@/lib/today/logic";
import type { ActiveStreak, FullDivergence, FullSignal, LayeringPatternFull } from "@/lib/today/types";
import { deltaColor, fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const openTicker = (t: string) => router.push(`/ticker/${encodeURIComponent(t)}`);
const openFund = (f: string) => router.push(`/fund/${encodeURIComponent(f)}`);

/** The website's KPI bar: six tiles, each with its one-line meaning. */
export function KpiGrid({ items }: { items: Kpi[] }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.kpis}>
        {items.map((k) => (
          <Pressable key={k.key} onPress={() => setOpen(open === k.key ? null : k.key)} accessibilityRole="button" style={styles.kpi}>
            <Mono bold style={{ fontSize: 20 }}>{k.value}</Mono>
            <Text style={styles.kpiLabel}>{k.label.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {open ? <Hint>{items.find((k) => k.key === open)?.blurb}</Hint> : null}
    </View>
  );
}

/** Amber "data is N business days stale" bar, the website's ⚠ on LAST UPDATED. */
export function StaleBanner({ text }: { text: string }) {
  const c = useTheme();
  return (
    <View style={{ backgroundColor: c.warnBg, borderColor: c.warnBorder, borderWidth: 1, borderRadius: radii.md, padding: spacing.md }}>
      <Text style={{ color: c.warnText, fontFamily: fonts.bodyMedium, fontSize: 13 }}>⚠ {text}</Text>
    </View>
  );
}

/** One signal in full: every number the API serves, with each fund's move expandable. */
export function SignalDetailCard({ s, rank }: { s: FullSignal; rank: number }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const buy = s.direction === "buying";
  const col = buy ? c.buy : c.sell;
  const streak = signalStreak(s);
  return (
    <Card style={{ gap: spacing.sm }}>
      <Tappable onPress={() => openTicker(s.ticker)} style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Mono style={{ fontSize: 12, color: c.textMuted }}>#{rank}</Mono>
          <Mono bold style={{ fontSize: 20 }}>{s.ticker}</Mono>
          <View style={{ flex: 1 }} />
          <Mono bold style={{ fontSize: 16, color: col }}>{formatPp(s.totalWeightDelta)}</Mono>
        </View>
        <Text style={styles.name} numberOfLines={1}>{cleanName(s.name)}{s.sector ? ` · ${sectorShort(s.sector)}` : ""}</Text>
        <Hint>{signalSummary(s)}</Hint>
      </Tappable>
      <View style={styles.row}>
        <Badge label={buy ? "BUYING" : "SELLING"} color={col} />
        <Badge label={convText(s.convictionScore).toUpperCase()} color={c.accent} />
        {streak ? <Badge label={streak.toUpperCase()} color={c.isNew} /> : null}
        <Hint>avg {formatPp(s.avgWeightDelta)} per fund · raw {formatPp(s.rawWeightDelta)}</Hint>
      </View>
      <View style={styles.row}>
        {s.providers.map((p) => <View key={p} style={styles.chip}><Text style={styles.chipText}>{p}</Text></View>)}
      </View>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ minHeight: 36, justifyContent: "center" }}>
        <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 12 }}>{open ? "Hide funds ▴" : `Funds (${s.fundDetails.length}) ▾`}</Text>
      </Pressable>
      {open && s.fundDetails.map((f) => {
        const usd = fundPositionUsd(f);
        return (
          <Tappable key={f.fund} onPress={() => openFund(f.fund)} style={styles.fundRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.fundName}>{f.fund}  <Text style={{ color: f.type === "NEW" ? c.isNew : c.textMuted, fontFamily: fonts.bodyBold, fontSize: 10 }}>{f.type === "NEW" ? "NEW" : f.type === "REMOVED" ? "EXIT" : ""}</Text></Text>
              <Hint>
                weight now {f.currentWeight.toFixed(2)}%{usd != null ? ` · est. ${formatUsd(usd)}` : ""}{f.aumUsd != null || f.aum != null ? ` · AUM ${formatUsd(f.aumUsd ?? (f.aum as number) * 1e9)}` : ""}
              </Hint>
              <Hint>raw {formatPp(f.rawWeightDelta)} · {f.sharesDelta > 0 ? "+" : f.sharesDelta < 0 ? "−" : ""}{Math.abs(Math.round(f.sharesDelta)).toLocaleString("en-US")} sh</Hint>
            </View>
            <Mono bold style={{ fontSize: 14, color: deltaColor(f.activeWeightDelta, c) }}>{formatPp(f.activeWeightDelta)}</Mono>
          </Tappable>
        );
      })}
    </Card>
  );
}

export function StreakRow({ s }: { s: ActiveStreak }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Tappable onPress={() => openTicker(s.ticker)} style={styles.line}>
      <Mono bold style={{ fontSize: 15, minWidth: 64 }}>{s.ticker}</Mono>
      <Text style={styles.fundName}>{s.fund}</Text>
      <View style={{ flex: 1 }} />
      <Mono bold style={{ color: s.direction === "up" ? c.buy : c.sell }}>🔥 {streakLabel(s.days, s.direction)}</Mono>
    </Tappable>
  );
}

export function DivergenceCard({ d }: { d: FullDivergence }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card style={{ gap: spacing.sm }}>
      <Tappable onPress={() => openTicker(d.ticker)} style={{ gap: 2 }}>
        <Mono bold style={{ fontSize: 18 }}>{d.ticker}</Mono>
        <Text style={styles.name} numberOfLines={1}>{cleanName(d.name)}</Text>
      </Tappable>
      <View style={styles.row}>
        {d.intrashop ? <Badge label="ONE SHOP, BOTH SIDES" color={c.isNew} /> : null}
        {d.crossCategory ? <Badge label="OVERLAY VS STOCK-PICKER" color={c.textSecondary} /> : null}
      </View>
      {d.crossCategory ? <Hint>A stock-picker and an option-overlay fund disagree: that is usually mechanics, not conviction.</Hint> : null}
      <Hint>BUYING</Hint>
      {d.buyingFunds.map((f) => (
        <Tappable key={`b-${f.fund}`} onPress={() => openFund(f.fund)} style={styles.fundRow}>
          <Text style={styles.fundName}>{f.fund}</Text><Hint>{f.provider}</Hint><View style={{ flex: 1 }} />
          <Mono style={{ color: c.buy }}>{formatPp(f.weightDelta)}</Mono>
        </Tappable>
      ))}
      <Hint>SELLING</Hint>
      {d.sellingFunds.map((f) => (
        <Tappable key={`s-${f.fund}`} onPress={() => openFund(f.fund)} style={styles.fundRow}>
          <Text style={styles.fundName}>{f.fund}</Text><Hint>{f.provider}</Hint><View style={{ flex: 1 }} />
          <Mono style={{ color: c.sell }}>{formatPp(f.weightDelta)}</Mono>
        </Tappable>
      ))}
    </Card>
  );
}

/** One layering pattern: strength, who/how many, combined AUM vs estimated position, and the first-mover-to-last sequence. */
export function LayeringCard({ p, rank }: { p: LayeringPatternFull; rank: number }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const cross = p.distinctProviders >= 2;
  return (
    <Card style={{ gap: spacing.sm }}>
      <Tappable onPress={() => openTicker(p.ticker)} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Mono style={{ fontSize: 12, color: c.textMuted }}>#{rank}</Mono>
            <Mono bold style={{ fontSize: 20 }}>{p.ticker}</Mono>
          </View>
          <Text style={styles.name} numberOfLines={1}>{cleanName(p.name)}{p.sector ? ` · ${sectorShort(p.sector)}` : ""}</Text>
          <Hint>
            {p.distinctFunds} funds · {p.distinctProviders} {p.distinctProviders === 1 ? "family" : "families"}{cross ? " (cross-family)" : ""}
          </Hint>
          <Hint>{usdOrDash(p.consensusAumUsd ?? p.consensusAum * 1e9)} combined fund AUM (not capital in this stock){p.positionUsdTotal != null ? ` · est. ${formatUsd(p.positionUsdTotal)} entry positions` : ""}</Hint>
          <Hint>first entry {p.firstEntry} · last {p.lastEntry}</Hint>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Mono bold style={{ fontSize: 26, color: c.accent }}>{strengthText(p.layeringStrength)}</Mono>
          <Hint>strength</Hint>
        </View>
      </Tappable>
      <View style={{ height: 6, backgroundColor: c.border, borderRadius: 3, overflow: "hidden" }}>
        <View style={{ width: `${Math.min(100, Math.max(0, p.layeringStrength))}%`, height: 6, backgroundColor: c.accent }} />
      </View>
      <Hint>ENTRY SEQUENCE · FIRST MOVER TO LAST</Hint>
      {p.entrySequence.map((e, j) => (
        <Tappable key={`${e.fund}-${j}`} onPress={() => openFund(e.fund)} style={styles.fundRow}>
          <View style={{ width: 22 }}><Mono style={{ fontSize: 12, color: c.textMuted }}>{j + 1}</Mono></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.fundName}>{e.fund}  <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 11 }}>{e.provider}</Text></Text>
            <Hint>
              {e.entryDate.slice(5)} · {e.daysIntoLayering === 0 ? "1st day" : `+${e.daysIntoLayering}d`} · weight {e.weight}%{e.positionUsd != null ? ` · est. ${formatUsd(e.positionUsd)}` : ""}
            </Hint>
          </View>
          <Hint>AUM {usdOrDash(e.aumUsd ?? (e.aum != null ? e.aum * 1e9 : null))}</Hint>
        </Tappable>
      ))}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    kpis: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    kpi: { flexGrow: 1, flexBasis: "30%", minWidth: 100, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.card, paddingVertical: spacing.md, alignItems: "center", gap: 4 },
    kpiLabel: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.6 },
    name: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
    chip: { borderColor: c.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: c.canvas },
    chipText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 11 },
    fundRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderTopColor: c.border, borderTopWidth: 1 },
    fundName: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 },
    line: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: c.border, borderBottomWidth: 1 },
  });
