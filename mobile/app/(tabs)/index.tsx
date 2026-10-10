import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { HeroCard } from "@/components/hero-card";
import { SignalRow } from "@/components/signal-row";
import {
  Card, ErrorNote, Hint, Loading, Mono, Note, Screen, SectionHeader, Segmented, StatTile, Tappable,
} from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { addReduceCounts, alsoWorthLook, consensusCards, convictionFractions, mergeSectorFlow, pickHero } from "@/lib/derive";
import { cleanName, formatPp, formatShortDate, formatUsd, sectorShort } from "@/lib/format";
import { useDivergences, useFunds, useLayering, useSectors, useSignals } from "@/lib/queries";
import { deltaColor, display, fonts, MIN_TAP, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { CategoryChoice } from "@/lib/types";

const REFERRAL_URL = "https://www.tradermatrix.pro/?ref=MPHINANCE";
const CATEGORIES: { value: CategoryChoice; label: string }[] = [
  { value: "active-equity", label: "Active Equity" },
  { value: "option-income", label: "Option-Income" },
  { value: "all", label: "All" },
];

export default function Today() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
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

  const hero = pickHero(divergences.data, signals.data);
  const worth = alsoWorthLook(signals.data, hero?.ticker);
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
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>THE DAILY EVIDENCE BRIEF</Text>
        </View>
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Settings" style={styles.gear}>
          <Ionicons name="settings-outline" size={20} color={c.textSecondary} />
        </Pressable>
      </View>
      <Text style={styles.headline}>The daily shift.</Text>
      <Text style={styles.sub}>
        {asOf ? `${formatShortDate(asOf)} disclosures` : "Institutional ETF moves"}
        {stats ? ` · ${stats.fundsTracked} funds tracked` : ""}
      </Text>

      <Segmented options={CATEGORIES} value={category} onChange={setCategory} />
      {category === "option-income" && (
        <Note>Option-income funds churn their stock books by design, so deltas here are mechanics, not a view on the company.</Note>
      )}

      {signals.isLoading && <Loading />}
      {signals.isError && <ErrorNote message="Couldn't load today's signals. Check your connection." onRetry={refresh} />}

      {hero && <HeroCard story={hero} />}

      {worth.length > 0 && (
        <>
          <SectionHeader title="Also worth a look" right={<Hint>active weight</Hint>} />
          <View>
            {worth.map((w) => (
              <Tappable key={w.ticker} onPress={() => router.push(`/ticker/${encodeURIComponent(w.ticker)}`)} style={styles.worthRow}>
                <View style={styles.worthMark}><Text style={styles.worthMarkText} numberOfLines={1} adjustsFontSizeToFit>{w.ticker}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.worthTitle}>{w.title}</Text>
                  <Hint>{w.sub}</Hint>
                </View>
                <Text style={[styles.worthValue, { color: deltaColor(w.delta, c) }]}>{formatPp(w.delta)}</Text>
              </Tappable>
            ))}
          </View>
        </>
      )}

      {stats && (
        <View style={styles.tiles}>
          <StatTile label="New" value={String(stats.newPositionsToday)} color={c.isNew} />
          <StatTile label="Exits" value={String(stats.exitsToday)} color={c.sell} />
          <StatTile label="Add/Cut" value={ratio} color={c.buy} />
        </View>
      )}

      {consensus.length > 0 && (
        <>
          <SectionHeader title="Consensus" right={<Hint>last {layering.data?.windowDays ?? 7} days</Hint>} />
          {consensus.map((k) => (
            <Tappable key={k.ticker} onPress={() => router.push(`/ticker/${encodeURIComponent(k.ticker)}`)}>
              <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Mono bold style={{ fontSize: 18 }}>{k.ticker}</Mono>
                  <Text style={styles.name} numberOfLines={1}>{cleanName(k.name)}</Text>
                  <Text style={styles.name}>
                    {k.fundCount} funds from {k.providerCount} {k.providerCount === 1 ? "provider" : "providers"} entered since {formatShortDate(k.firstEntry)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Mono bold style={{ color: c.accent, fontSize: 15 }}>{k.usd != null ? formatUsd(k.usd) : "—"}</Mono>
                  <Hint>{k.usd == null ? "size unknown" : k.estimated ? "est. position" : "position"}</Hint>
                </View>
              </Card>
            </Tappable>
          ))}
        </>
      )}

      {flow.length > 0 && (
        <>
          <SectionHeader title="Sector flow" right={<Hint>net active weight</Hint>} />
          <Card>
            {flow.map((f) => {
              const up = f.delta >= 0;
              const w = `${Math.max(4, (Math.abs(f.delta) / maxFlow) * 100)}%` as const;
              return (
                <View key={f.sector} style={styles.flowRow}>
                  <Text style={styles.flowLabel} numberOfLines={1}>{sectorShort(f.sector)}</Text>
                  <View style={styles.flowTrack}>
                    <View style={[styles.flowHalf, { alignItems: "flex-end" }]}>
                      {!up && <View style={[styles.flowBar, { width: w, backgroundColor: c.sell }]} />}
                    </View>
                    <View style={styles.flowAxis} />
                    <View style={styles.flowHalf}>
                      {up && <View style={[styles.flowBar, { width: w, backgroundColor: c.buy }]} />}
                    </View>
                  </View>
                  <Mono style={{ width: 66, textAlign: "right", fontSize: 12, color: up ? c.buy : c.sell }}>{formatPp(f.delta)}</Mono>
                </View>
              );
            })}
          </Card>
        </>
      )}

      {buys.length > 0 && (
        <>
          <SectionHeader title="Top buys" right={<Hint>active weight</Hint>} />
          <Card style={{ paddingVertical: spacing.sm }}>
            {buys.map((s, i) => <SignalRow key={`b-${s.ticker}`} signal={s} conviction={buyConv[i]} />)}
          </Card>
        </>
      )}
      {sells.length > 0 && (
        <>
          <SectionHeader title="Top sells" right={<Hint>active weight</Hint>} />
          <Card style={{ paddingVertical: spacing.sm }}>
            {sells.map((s, i) => <SignalRow key={`s-${s.ticker}`} signal={s} conviction={sellConv[i]} />)}
          </Card>
        </>
      )}
      {signals.data && buys.length === 0 && sells.length === 0 && (
        <Card><Note>No signals in this category for the latest data.</Note></Card>
      )}

      {signals.data && (
        <View style={styles.footer}>
          <Text style={styles.caught}>You&apos;re caught up</Text>
          <Hint>
            Data as of {formatShortDate(asOf)}
            {staleCount > 0 ? ` · ${staleCount} ${staleCount === 1 ? "fund is" : "funds are"} on an older disclosure` : ""}
          </Hint>
          <Tappable onPress={() => Linking.openURL(REFERRAL_URL)} style={{ justifyContent: "center" }}>
            <Text style={styles.referral}>Explore the setup on TraderMatrix · referral link</Text>
          </Tappable>
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    topRow: { flexDirection: "row", alignItems: "center" },
    eyebrow: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4 },
    gear: { width: MIN_TAP, height: MIN_TAP, alignItems: "center", justifyContent: "center", marginRight: -spacing.sm },
    headline: { ...display, color: c.textPrimary, fontSize: 44, lineHeight: 48, marginTop: -spacing.sm },
    sub: { color: c.textMuted, fontFamily: fonts.body, fontSize: 12 },
    tiles: { flexDirection: "row", gap: spacing.sm },
    name: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    worthRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: c.border, borderBottomWidth: 1 },
    worthMark: { width: 48, height: 44, borderRadius: 10, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
    worthMarkText: { color: c.textPrimary, fontFamily: fonts.monoBold, fontSize: 12 },
    worthTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    worthValue: { fontFamily: fonts.monoBold, fontSize: 15 },
    flowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
    flowLabel: { width: 124, color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    flowTrack: { flex: 1, flexDirection: "row", alignItems: "center", height: 14 },
    flowHalf: { flex: 1, height: 14, justifyContent: "center" },
    flowAxis: { width: 1, height: 14, backgroundColor: c.border },
    flowBar: { height: 8, borderRadius: 4 },
    footer: { alignItems: "center", gap: 4, paddingVertical: spacing.xl },
    caught: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    referral: { color: c.textMuted, fontFamily: fonts.body, fontSize: 12, textDecorationLine: "underline" },
  });
