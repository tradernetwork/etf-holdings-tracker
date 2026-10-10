import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Badge, Card, ErrorNote, FreshnessLabel, Loading, Mono, Note, Screen, SectionHeader, ThinBar, Tappable } from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { splitEvidence } from "@/lib/derive";
import { ApiError } from "@/lib/api";
import { cleanName, formatPp, formatUsdValue, formatWeight, freshnessLabel, resolveUsd, sectorLabel } from "@/lib/format";
import { useTicker } from "@/lib/queries";
import { colors, deltaColor, fonts, MIN_TAP, radii, spacing } from "@/lib/theme";
import type { Change } from "@/lib/types";

const HOLDERS_COLLAPSED = 12;

export default function TickerScreen() {
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
            <Mono bold style={{ fontSize: 22 }}>{symbol}</Mono>
            <Note>No tracked fund holds {symbol}. Check the symbol, or browse funds in Explore.</Note>
          </Card>
        ) : (
          <ErrorNote message="Couldn't load this ticker." onRetry={() => q.refetch()} />
        )}
      </Screen>
    );
  }

  const t = q.data;
  const equityHoldings = t.holdings.filter((h) => !h.isOption).sort((a, b) => b.weight - a.weight);
  const aumByFund = new Map(t.holdings.map((h) => [h.fund, h.aum]));
  const changeByFund = new Map(t.changes.filter((c) => !c.isOption).map((c) => [c.fund, c]));
  const { added, reduced } = splitEvidence(t.changes);
  const maxWeight = Math.max(0.0001, ...equityHoldings.map((h) => h.weight));
  const shown = showAll ? equityHoldings : equityHoldings.slice(0, HOLDERS_COLLAPSED);
  const following = isFollowing(symbol);

  return (
    <Screen topInset={false}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Mono bold style={{ fontSize: 32 }}>{t.ticker}</Mono>
          <Text style={styles.name}>{cleanName(t.name)}</Text>
          <Text style={styles.meta}>
            {[sectorLabel(t.sector), `${equityHoldings.length} ${equityHoldings.length === 1 ? "fund holds" : "funds hold"} it`].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Pressable
          onPress={() => toggleFollow(symbol)}
          accessibilityRole="button"
          accessibilityState={{ selected: following }}
          style={[styles.follow, following && { backgroundColor: colors.accent + "26", borderColor: colors.accent }]}
        >
          <Ionicons name={following ? "star" : "star-outline"} size={16} color={following ? colors.accent : colors.textSecondary} />
          <Text style={[styles.followText, following && { color: colors.accent }]}>{following ? "Following" : "Follow"}</Text>
        </Pressable>
      </View>

      <SectionHeader title="Today's evidence" right={<Text style={styles.hint}>active weight · est. $ flow</Text>} />
      {added.length === 0 && reduced.length === 0 ? (
        <Card><Note>No fund changed its {symbol} position in the latest files. Older disclosures are marked below.</Note></Card>
      ) : (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <EvidenceColumn title="Added" color={colors.buy} rows={added} aumByFund={aumByFund} />
          <EvidenceColumn title="Reduced" color={colors.sell} rows={reduced} aumByFund={aumByFund} />
        </View>
      )}

      <SectionHeader title="All holders" right={<Text style={styles.hint}>weight in fund</Text>} />
      <Card style={{ paddingVertical: spacing.sm, gap: 0 }}>
        {shown.map((h) => {
          const c = changeByFund.get(h.fund);
          const f = freshnessLabel({ stale: h.stale, date: h.fileDate });
          return (
            <Tappable key={h.fund} onPress={() => router.push(`/fund/${encodeURIComponent(h.fund)}`)} style={styles.holderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Mono bold style={{ fontSize: 15 }}>{h.fund}</Mono>
                <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                  {c && <Mono style={{ fontSize: 12, color: deltaColor(c.activeWeightDelta) }}>{formatPp(c.activeWeightDelta)}</Mono>}
                  <Mono style={{ fontSize: 13, width: 60, textAlign: "right" }}>{formatWeight(h.weight)}</Mono>
                </View>
              </View>
              <ThinBar fraction={h.weight / maxWeight} color={colors.accent} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.hint}>{h.provider}</Text>
                <FreshnessLabel freshness={f} />
              </View>
            </Tappable>
          );
        })}
        {equityHoldings.length > HOLDERS_COLLAPSED && (
          <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: "center", alignItems: "center" }}>
            <Text style={{ color: colors.accent, fontFamily: fonts.bodyBold }}>
              {showAll ? "Show fewer" : `Show all ${equityHoldings.length}`}
            </Text>
          </Pressable>
        )}
      </Card>

      <Text style={[styles.hint, { marginTop: spacing.md }]}>Source name: {t.name}</Text>
    </Screen>
  );
}

function EvidenceColumn({
  title, color, rows, aumByFund,
}: {
  title: string; color: string; rows: Change[]; aumByFund: Map<string, number | null>;
}) {
  return (
    <Card style={{ flex: 1, padding: spacing.md, gap: spacing.sm }}>
      <Text style={{ color, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8 }}>
        {title.toUpperCase()} · {rows.length}
      </Text>
      {rows.length === 0 && <Text style={styles.hint}>None today</Text>}
      {rows.slice(0, 6).map((c) => {
        const usd = resolveUsd({ apiUsd: c.activeFlowUsd, weightPercent: c.activeWeightDelta, aumBillions: aumByFund.get(c.fund) });
        return (
          <Tappable key={c.fund} onPress={() => router.push(`/fund/${encodeURIComponent(c.fund)}`)} style={{ justifyContent: "center", gap: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Mono bold style={{ fontSize: 14 }}>{c.fund}</Mono>
              {c.type === "NEW" && <Badge label="NEW" color={colors.isNew} />}
            </View>
            <Mono style={{ fontSize: 13, color }}>{formatPp(c.activeWeightDelta)}</Mono>
            <Text style={styles.hint}>{formatUsdValue(usd)}</Text>
          </Tappable>
        );
      })}
      {rows.length > 6 && <Text style={styles.hint}>+{rows.length - 6} more</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  name: { color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 15 },
  meta: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 },
  follow: {
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TAP, paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, backgroundColor: colors.card,
  },
  followText: { color: colors.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
  holderRow: { paddingVertical: spacing.sm, gap: 5, justifyContent: "center" },
});
