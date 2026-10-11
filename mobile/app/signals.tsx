import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DivergenceCard, KpiGrid, SignalDetailCard, StaleBanner, StreakRow } from "@/components/today/Parts";
import { Chip } from "@/components/options/parts";
import { Card, ErrorNote, Hint, Loading, Mono, Note, Screen, SectionHeader, Tappable } from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { formatPp, formatShortDate, sectorShort } from "@/lib/format";
import { allSectorFlow, kpis, staleMessage } from "@/lib/today/logic";
import { useTodayFull } from "@/lib/today/queries";
import { display, fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

type Tab = "buys" | "sells" | "briefing" | "divergences" | "sectors";
const TABS: { value: Tab; label: string }[] = [
  { value: "buys", label: "Buys" }, { value: "sells", label: "Sells" }, { value: "briefing", label: "Briefing" },
  { value: "divergences", label: "Divergences" }, { value: "sectors", label: "Sectors" },
];

/** Today in full: every list the API serves behind the Today excerpts, with the numbers the website shows. */
export default function TodayInFull() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const { category } = useAppState();
  const q = useTodayFull(category === "all" ? undefined : category);
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t.value === tabParam)?.value ?? "buys");
  const d = q.data;
  const flow = useMemo(() => allSectorFlow(d?.sectorFlow), [d]);
  const maxFlow = Math.max(0.0001, ...flow.map((f) => Math.abs(f.delta)));
  const stale = staleMessage(d?.asOfDate);
  const catchUp = Object.entries(d?.catchUp ?? {});

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={styles.title}>Today in full</Text>
      <Hint>{d ? `${formatShortDate(d.asOfDate)} disclosures` : "Every signal, streak, divergence and sector move"}{category !== "all" ? ` · ${category === "active-equity" ? "Active Equity" : "Option-Income"} funds` : " · all funds"}</Hint>
      {stale ? <StaleBanner text={stale} /> : null}
      {catchUp.length > 0 && (
        <Note>Catching up from stale data, so their daily moves are withheld: {catchUp.map(([f, s]) => `${f}${s ? ` (since ${formatShortDate(s)})` : ""}`).join(", ")}.</Note>
      )}
      {q.isLoading && <Loading />}
      {q.isError && <ErrorNote message="Couldn't load today's full lists." onRetry={() => q.refetch()} />}
      {d && <KpiGrid items={kpis(d.stats)} />}

      {d && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {TABS.map((t) => <Chip key={t.value} label={t.label} on={tab === t.value} onPress={() => setTab(t.value)} />)}
          </View>

          {tab === "buys" && (
            <>
              <Hint>{d.signals.buying.length} buying signals, ranked by conviction. Active weight, percentage points.</Hint>
              {d.signals.buying.length === 0 && <Card><Note>No buying signals in this category for the latest data.</Note></Card>}
              {d.signals.buying.map((s, i) => <SignalDetailCard key={s.ticker} s={s} rank={i + 1} />)}
            </>
          )}
          {tab === "sells" && (
            <>
              <Hint>{d.signals.selling.length} selling signals, ranked by conviction. Active weight, percentage points.</Hint>
              {d.signals.selling.length === 0 && <Card><Note>No selling signals in this category for the latest data.</Note></Card>}
              {d.signals.selling.map((s, i) => <SignalDetailCard key={s.ticker} s={s} rank={i + 1} />)}
            </>
          )}
          {tab === "briefing" && (
            <>
              <SectionHeader title="Top buys" right={<Hint>{d.briefing.topBuys.length}</Hint>} />
              {d.briefing.topBuys.map((s, i) => <SignalDetailCard key={`tb-${s.ticker}`} s={s} rank={i + 1} />)}
              {d.briefing.topBuys.length === 0 && <Card><Note>None.</Note></Card>}
              <SectionHeader title="Top sells" right={<Hint>{d.briefing.topSells.length}</Hint>} />
              {d.briefing.topSells.map((s, i) => <SignalDetailCard key={`ts-${s.ticker}`} s={s} rank={i + 1} />)}
              {d.briefing.topSells.length === 0 && <Card><Note>None.</Note></Card>}
              <SectionHeader title="Multi-provider" right={<Hint>{d.briefing.crossFundConvergence.length}</Hint>} />
              {d.briefing.crossFundConvergence.length === 0 && <Card><Note>No cross-provider signals.</Note></Card>}
              {d.briefing.crossFundConvergence.map((s, i) => <SignalDetailCard key={`cf-${s.ticker}`} s={s} rank={i + 1} />)}
              <SectionHeader title="Active streaks" right={<Hint>{d.briefing.activeStreaks.length}</Hint>} />
              <Card style={{ paddingVertical: spacing.xs }}>
                {d.briefing.activeStreaks.length === 0 && <Note>No active streaks.</Note>}
                {d.briefing.activeStreaks.map((s) => <StreakRow key={`${s.fund}-${s.ticker}`} s={s} />)}
              </Card>
              <SectionHeader title="New options" right={<Tappable onPress={() => router.push("/options/activity")}><Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 12 }}>All option activity ↗</Text></Tappable>} />
              {d.briefing.notableOptions.length === 0 && <Card><Note>No notable new options.</Note></Card>}
              {d.briefing.notableOptions.map((o, i) => (
                <Tappable key={i} onPress={() => router.push(`/ticker/${encodeURIComponent(o.record.optionDetails?.underlying ?? o.record.ticker)}`)}>
                  <Card style={{ gap: 3 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={styles.optTitle}>{o.record.name || o.record.ticker}</Text>
                      <Text style={styles.optFund}>{o.record.fund}</Text>
                    </View>
                    <Hint>{o.signal.strategy} · {o.signal.directionalView} · {o.signal.moneyness}</Hint>
                  </Card>
                </Tappable>
              ))}
            </>
          )}
          {tab === "divergences" && (
            <>
              <Hint>{d.divergences.length} stocks where one side of the book is buying and another selling.</Hint>
              {d.divergences.length === 0 && <Card><Note>No divergences in this category.</Note></Card>}
              {d.divergences.map((x) => <DivergenceCard key={x.ticker} d={x} />)}
            </>
          )}
          {tab === "sectors" && (
            <>
              <Hint>{flow.length} sectors, net active weight (percentage points), biggest move first.</Hint>
              <Card>
                {flow.length === 0 && <Note>No sector flow.</Note>}
                {flow.map((f) => {
                  const up = f.delta >= 0;
                  const w = `${Math.max(4, (Math.abs(f.delta) / maxFlow) * 100)}%` as const;
                  return (
                    <View key={f.sector} style={styles.flowRow}>
                      <Text style={styles.flowLabel} numberOfLines={1}>{sectorShort(f.sector)}</Text>
                      <View style={styles.flowTrack}>
                        <View style={[styles.flowHalf, { alignItems: "flex-end" }]}>{!up && <View style={[styles.flowBar, { width: w, backgroundColor: c.sell }]} />}</View>
                        <View style={styles.flowAxis} />
                        <View style={styles.flowHalf}>{up && <View style={[styles.flowBar, { width: w, backgroundColor: c.buy }]} />}</View>
                      </View>
                      <Mono style={{ width: 66, textAlign: "right", fontSize: 12, color: up ? c.buy : c.sell }}>{formatPp(f.delta)}</Mono>
                    </View>
                  );
                })}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { color: c.textPrimary, ...display, fontSize: 30 },
    optTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14, flex: 1 },
    optFund: { color: c.textSecondary, fontFamily: fonts.monoBold, fontSize: 12 },
    flowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
    flowLabel: { width: 124, color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    flowTrack: { flex: 1, flexDirection: "row", alignItems: "center", height: 14 },
    flowHalf: { flex: 1, height: 14, justifyContent: "center" },
    flowAxis: { width: 1, height: 14, backgroundColor: c.border },
    flowBar: { height: 8, borderRadius: 4 },
  });
