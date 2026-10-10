import { router } from "expo-router";
import { Linking, StyleSheet, Text, View } from "react-native";
import { SignalRow } from "@/components/signal-row";
import {
  Card, ErrorNote, Loading, Mono, Note, Screen, SectionHeader, Segmented, StatTile, Tappable,
} from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { addReduceCounts, consensusCards, convictionFractions, mergeSectorFlow } from "@/lib/derive";
import { cleanName, formatPp, formatShortDate, formatUsd, sectorShort } from "@/lib/format";
import { useDivergences, useFunds, useLayering, useSectors, useSignals } from "@/lib/queries";
import { colors, fonts, spacing } from "@/lib/theme";
import type { CategoryChoice } from "@/lib/types";

const REFERRAL_URL = "https://www.tradermatrix.pro/?ref=MPHINANCE";
const CATEGORIES: { value: CategoryChoice; label: string }[] = [
  { value: "active-equity", label: "Active Equity" },
  { value: "option-income", label: "Option-Income" },
  { value: "all", label: "All" },
];

export default function Today() {
  const { category, setCategory } = useAppState();
  const signals = useSignals(category);
  const funds = useFunds();
  const layering = useLayering();
  const divergences = useDivergences(category);
  const sectors = useSectors(category);

  const refresh = () => {
    signals.refetch(); funds.refetch(); layering.refetch(); divergences.refetch(); sectors.refetch();
  };
  const asOf = signals.data?.asOfDate;
  const stats = signals.data?.stats;
  const counts = addReduceCounts(signals.data?.changes);
  const ratio = counts && counts.reduced > 0 ? (counts.added / counts.reduced).toFixed(2) : "—";

  const buys = signals.data?.signals.buying.slice(0, 5) ?? [];
  const sells = signals.data?.signals.selling.slice(0, 5) ?? [];
  const buyConv = convictionFractions(buys);
  const sellConv = convictionFractions(sells);
  const consensus = layering.data ? consensusCards(layering.data.patterns, funds.data?.funds, category) : [];
  const flow = sectors.data ? mergeSectorFlow(sectors.data.inflows, sectors.data.outflows).slice(0, 6) : [];
  const maxFlow = Math.max(0.0001, ...flow.map((f) => Math.abs(f.delta)));
  const staleCount = (funds.data?.funds ?? []).filter((f) => f.stale && (category === "all" || f.category === category)).length;

  return (
    <Screen refreshing={signals.isRefetching} onRefresh={refresh}>
      <View>
        <Text style={styles.brand}>TickerTrace</Text>
        <Text style={styles.sub}>{asOf ? `Institutional ETF moves · data as of ${formatShortDate(asOf)}` : "Institutional ETF moves"}</Text>
      </View>

      <View style={styles.tiles}>
        <StatTile label="Funds" value={stats ? String(stats.fundsTracked) : "—"} />
        <StatTile label="New" value={stats ? String(stats.newPositionsToday) : "—"} color={colors.isNew} />
        <StatTile label="Exits" value={stats ? String(stats.exitsToday) : "—"} color={colors.sell} />
        <StatTile label="Add/Cut" value={ratio} color={colors.buy} />
      </View>

      <Segmented options={CATEGORIES} value={category} onChange={setCategory} />
      {category === "option-income" && (
        <Note>Option-income funds churn their stock books by design, so deltas here are mechanics, not a view on the company.</Note>
      )}

      {signals.isLoading && <Loading />}
      {signals.isError && <ErrorNote message="Couldn't load today's signals. Check your connection." onRetry={refresh} />}

      {consensus.length > 0 && (
        <>
          <SectionHeader title="Consensus" right={<Text style={styles.hint}>last {layering.data?.windowDays ?? 7} days</Text>} />
          {consensus.map((c) => (
            <Tappable key={c.ticker} onPress={() => router.push(`/ticker/${encodeURIComponent(c.ticker)}`)}>
              <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Mono bold style={{ fontSize: 18 }}>{c.ticker}</Mono>
                  <Text style={styles.name} numberOfLines={1}>{cleanName(c.name)}</Text>
                  <Text style={styles.name}>
                    {c.fundCount} funds from {c.providerCount} {c.providerCount === 1 ? "provider" : "providers"} entered since {formatShortDate(c.firstEntry)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Mono bold style={{ color: colors.accent, fontSize: 15 }}>{c.usd != null ? formatUsd(c.usd) : "—"}</Mono>
                  <Text style={styles.hint}>{c.usd == null ? "size unknown" : c.estimated ? "est. position" : "position"}</Text>
                </View>
              </Card>
            </Tappable>
          ))}
        </>
      )}

      {(divergences.data?.length ?? 0) > 0 && (
        <>
          <SectionHeader title="Divergence" right={<Text style={styles.hint}>funds disagree</Text>} />
          <Card style={{ gap: spacing.sm }}>
            {divergences.data!.slice(0, 2).map((d) => {
              const b = d.buyingFunds[0];
              const s = d.sellingFunds[0];
              if (!b || !s) return null;
              return (
                <Tappable key={d.ticker} onPress={() => router.push(`/ticker/${encodeURIComponent(d.ticker)}`)} style={{ justifyContent: "center", paddingVertical: spacing.xs, gap: 2 }}>
                  <Mono bold style={{ color: colors.isNew, fontSize: 16 }}>{d.ticker}</Mono>
                  <Text style={[styles.divLine, { color: colors.buy }]}>▲ {b.fund} buying {formatPp(b.weightDelta)}</Text>
                  <Text style={[styles.divLine, { color: colors.sell }]}>▼ {s.fund} selling {formatPp(s.weightDelta)}</Text>
                </Tappable>
              );
            })}
          </Card>
        </>
      )}

      {buys.length > 0 && (
        <>
          <SectionHeader title="Top buys" right={<Text style={styles.hint}>active weight</Text>} />
          <Card style={{ paddingVertical: spacing.sm }}>
            {buys.map((s, i) => <SignalRow key={`b-${s.ticker}`} signal={s} conviction={buyConv[i]} />)}
          </Card>
        </>
      )}
      {sells.length > 0 && (
        <>
          <SectionHeader title="Top sells" right={<Text style={styles.hint}>active weight</Text>} />
          <Card style={{ paddingVertical: spacing.sm }}>
            {sells.map((s, i) => <SignalRow key={`s-${s.ticker}`} signal={s} conviction={sellConv[i]} />)}
          </Card>
        </>
      )}
      {signals.data && buys.length === 0 && sells.length === 0 && (
        <Card><Note>No signals in this category for the latest data.</Note></Card>
      )}

      {flow.length > 0 && (
        <>
          <SectionHeader title="Sector flow" right={<Text style={styles.hint}>net active weight</Text>} />
          <Card>
            {flow.map((f) => {
              const up = f.delta >= 0;
              const w = `${Math.max(4, (Math.abs(f.delta) / maxFlow) * 100)}%` as const;
              return (
                <View key={f.sector} style={styles.flowRow}>
                  <Text style={styles.flowLabel} numberOfLines={1}>{sectorShort(f.sector)}</Text>
                  <View style={styles.flowTrack}>
                    <View style={[styles.flowHalf, { alignItems: "flex-end" }]}>
                      {!up && <View style={[styles.flowBar, { width: w, backgroundColor: colors.sell }]} />}
                    </View>
                    <View style={styles.flowAxis} />
                    <View style={styles.flowHalf}>
                      {up && <View style={[styles.flowBar, { width: w, backgroundColor: colors.buy }]} />}
                    </View>
                  </View>
                  <Mono style={{ width: 66, textAlign: "right", fontSize: 12, color: up ? colors.buy : colors.sell }}>{formatPp(f.delta)}</Mono>
                </View>
              );
            })}
          </Card>
        </>
      )}

      {signals.data && (
        <View style={styles.footer}>
          <Text style={styles.caught}>You&apos;re caught up</Text>
          <Text style={styles.hint}>
            Data as of {formatShortDate(asOf)}
            {staleCount > 0 ? ` · ${staleCount} ${staleCount === 1 ? "fund is" : "funds are"} on an older disclosure` : ""}
          </Text>
          <Tappable onPress={() => Linking.openURL(REFERRAL_URL)} style={{ justifyContent: "center" }}>
            <Text style={styles.referral}>Explore the setup on TraderMatrix · referral link</Text>
          </Tappable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { color: colors.textPrimary, fontFamily: fonts.bodyBold, fontSize: 24 },
  sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  tiles: { flexDirection: "row", gap: spacing.sm },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 },
  name: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  divLine: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, lineHeight: 20 },
  flowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
  flowLabel: { width: 124, color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  flowTrack: { flex: 1, flexDirection: "row", alignItems: "center", height: 14 },
  flowHalf: { flex: 1, height: 14, justifyContent: "center" },
  flowAxis: { width: 1, height: 14, backgroundColor: colors.border },
  flowBar: { height: 8, borderRadius: 4 },
  footer: { alignItems: "center", gap: 4, paddingVertical: spacing.xl },
  caught: { color: colors.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
  referral: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textDecorationLine: "underline" },
});
