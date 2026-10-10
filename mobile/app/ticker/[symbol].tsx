import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MinorAdjustments } from "@/components/minor-adjustments";
import { Badge, Card, ErrorNote, FreshnessLabel, Hint, Loading, Monogram, Mono, Note, Screen, SectionHeader, Tappable } from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { ApiError } from "@/lib/api";
import { evidenceNote, tickerEvidence } from "@/lib/derive";
import { isSignificant } from "@/lib/significance";
import { cleanName, formatPp, formatUsdValue, formatWeight, freshnessLabel, resolveUsd, sectorLabel } from "@/lib/format";
import { useTicker } from "@/lib/queries";
import { deltaColor, display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { Moved } from "@/lib/types";

const HOLDERS_COLLAPSED = 8;
const EVIDENCE_PER_SIDE = 3;

export default function TickerScreen() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { symbol: raw } = useLocalSearchParams<{ symbol: string }>();
  const symbol = String(raw ?? "").toUpperCase();
  const q = useTicker(symbol);
  const { isFollowing, toggleFollow } = useAppState();
  const [showAll, setShowAll] = useState(false);

  if (q.isLoading) return <Screen topInset={false}><Loading /></Screen>;
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Screen topInset={false}>
        {notFound ? (
          <Card>
            <Text style={styles.symbol}>{symbol}</Text>
            <Note>No tracked fund holds {symbol}. Check the symbol, or browse funds in Explore.</Note>
          </Card>
        ) : (
          <ErrorNote message="Couldn't load this ticker." onRetry={() => q.refetch()} />
        )}
      </Screen>
    );
  }

  const t = q.data;
  const holdings = t.holdings.filter((h) => !h.isOption).sort((a, b) => b.weight - a.weight);
  const aumByFund = new Map(t.holdings.map((h) => [h.fund, h.aum]));
  const providerByFund = new Map(t.holdings.map((h) => [h.fund, h.provider]));
  const { added, reduced, minor } = tickerEvidence(t.changes);
  const evidence = [...added.slice(0, EVIDENCE_PER_SIDE), ...reduced.slice(0, EVIDENCE_PER_SIDE)];
  const hiddenEvidence = added.length + reduced.length - evidence.length;
  const changeByFund = new Map(t.changes.filter((ch) => !ch.isOption).map((ch) => [ch.fund, ch]));
  const shown = showAll ? holdings : holdings.slice(0, HOLDERS_COLLAPSED);
  const following = isFollowing("ticker", symbol);
  const verdict = added.length > 0 && reduced.length > 0 ? "A divided book." : added.length > 0 ? "Funds are adding." : reduced.length > 0 ? "Funds are trimming." : "No change today.";

  return (
    <Screen topInset={false}>
      <View>
        <Text style={styles.eyebrow}>{sectorLabel(t.sector).toUpperCase() || "STOCK ACTIVITY"}</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md, marginTop: spacing.xs }}>
          <Text style={styles.symbol}>{t.ticker}</Text>
          <Text style={styles.name} numberOfLines={1}>{cleanName(t.name)}</Text>
        </View>
        <Text style={styles.verdict}>{verdict}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{holdings.length} reporting {holdings.length === 1 ? "fund" : "funds"}</Text>
          </View>
          <Pressable
            onPress={() => toggleFollow("ticker", symbol)}
            accessibilityRole="button"
            accessibilityState={{ selected: following }}
            style={[styles.follow, following && { backgroundColor: c.accent + "22", borderColor: c.accent }]}
          >
            <Ionicons name={following ? "star" : "star-outline"} size={15} color={following ? c.accent : c.textSecondary} />
            <Text style={[styles.followText, following && { color: c.accent }]}>{following ? "Following" : "Follow"}</Text>
          </Pressable>
        </View>
      </View>

      <SectionHeader title="Opposite moves" right={<Hint>active weight, percentage points</Hint>} />
      {evidence.length === 0 ? (
        <Card><Note>No fund made a significant move in {symbol} in the latest files. Older disclosures are marked below.</Note></Card>
      ) : (
        evidence.map((ch) => (
          <EvidenceCard key={ch.fund} change={ch} provider={providerByFund.get(ch.fund)} aumBillions={aumByFund.get(ch.fund) ?? null} />
        ))
      )}
      {hiddenEvidence > 0 && <Hint>+{hiddenEvidence} more significant {hiddenEvidence === 1 ? "move" : "moves"} not shown</Hint>}
      <MinorAdjustments rows={minor} labelKey="fund" />

      <SectionHeader title="Who holds it" right={holdings.length > HOLDERS_COLLAPSED ? (
        <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: "center" }}>
          <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 12 }}>{showAll ? "Show fewer" : `View all ${holdings.length} ↗`}</Text>
        </Pressable>
      ) : undefined} />
      <View>
        {shown.map((h) => {
          const ch = changeByFund.get(h.fund);
          return (
            <Tappable key={h.fund} onPress={() => router.push(`/fund/${encodeURIComponent(h.fund)}`)} style={styles.holderRow}>
              <Monogram label={h.fund} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.holderTitle}>{h.fund}</Text>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Hint>{h.provider}</Hint>
                  <FreshnessLabel freshness={freshnessLabel({ stale: h.stale, date: h.fileDate })} />
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Mono bold style={{ fontSize: 15 }}>{formatWeight(h.weight)}</Mono>
                {ch && isSignificant(ch.fund, ch.activeWeightDelta)
                  ? <Mono style={{ fontSize: 11, color: deltaColor(ch.activeWeightDelta, c) }}>{formatPp(ch.activeWeightDelta)}</Mono>
                  : <Hint>fund allocation</Hint>}
              </View>
            </Tappable>
          );
        })}
      </View>

      <Hint style={{ marginTop: spacing.md }}>Source name: {t.name}</Hint>
    </Screen>
  );
}

function EvidenceCard({ change, provider, aumBillions }: { change: Moved; provider?: string; aumBillions: number | null }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const up = change.activeWeightDelta > 0;
  const color = up ? c.buy : c.sell;
  const usd = resolveUsd({ apiUsd: change.activeFlowUsd, weightPercent: change.activeWeightDelta, aumBillions });
  return (
    <Tappable onPress={() => router.push(`/fund/${encodeURIComponent(change.fund)}`)}>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.cardFund}>
            {change.fund}
            {provider ? <Text style={{ color: c.textMuted, fontFamily: fonts.body }}> / {provider}</Text> : null}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            {change.type === "NEW" && <Badge label="NEW" color={c.isNew} />}
            <Badge label={up ? "ADDED" : "REDUCED"} color={color} />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
          <Text style={[styles.bigDelta, { color }]}>{formatPp(change.activeWeightDelta)}</Text>
          <Hint>active weight</Hint>
        </View>
        <Text style={styles.step}>
          Fund weight <Text style={styles.stepVal}>{formatWeight(change.previousWeight)}</Text> → <Text style={[styles.stepVal, { color: c.textPrimary }]}>{formatWeight(change.currentWeight)}</Text>
          {usd.usd != null ? <Text style={{ color: c.textMuted }}>  ·  {formatUsdValue(usd)} flow</Text> : null}
        </Text>
        <Text style={styles.evNote}>{evidenceNote(change)}</Text>
      </Card>
    </Tappable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    eyebrow: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4 },
    symbol: { ...display, color: c.textPrimary, fontSize: 56, lineHeight: 60 },
    name: { color: c.textMuted, fontFamily: fonts.body, fontSize: 15, flex: 1, paddingBottom: 10 },
    verdict: { ...display, color: c.textPrimary, fontSize: 24, letterSpacing: -0.8, marginTop: spacing.xs },
    pill: { borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 12, minHeight: 32, justifyContent: "center", backgroundColor: c.card },
    pillText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 12 },
    follow: {
      flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TAP, paddingHorizontal: spacing.md,
      borderWidth: 1, borderColor: c.border, borderRadius: radii.pill, backgroundColor: c.card,
    },
    followText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
    cardFund: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15, flexShrink: 1 },
    bigDelta: { fontFamily: fonts.monoBold, fontSize: 32, letterSpacing: -1 },
    step: { color: c.textMuted, fontFamily: fonts.body, fontSize: 13 },
    stepVal: { fontFamily: fonts.mono, color: c.textSecondary },
    evNote: { color: c.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, borderTopColor: c.border, borderTopWidth: 1, paddingTop: spacing.sm },
    holderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: c.border, borderBottomWidth: 1 },
    holderTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
  });
