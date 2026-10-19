import { snapshotSpan } from "@/lib/deltaPeriod";
import { plural } from "@/lib/format";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DivergenceCard, KpiGrid, SignalDetailCard, StaleBanner, StreakRow } from "@/components/today/Parts";
import { Chip } from "@/components/options/parts";
import { Card, Hint, Mono, Note, Screen, SectionHeader, Tappable, QueryStatus } from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { formatPp, formatShortDate, sectorShort } from "@/lib/format";
import { allSectorFlow, coverageText, FULL_LIMIT, kpis, listState, PAGE_STEP, staleMessage } from "@/lib/today/logic";
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
  const q = useTodayFull(category === "all" ? undefined : category, FULL_LIMIT);
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t.value === tabParam)?.value ?? "buys");
  const d = q.data;
  const flow = useMemo(() => allSectorFlow(d?.sectorFlow), [d]);
  const maxFlow = Math.max(0.0001, ...flow.map((f) => Math.abs(f.delta)));
  const stale = staleMessage(d?.asOfDate);
  const catchUp = Object.entries(d?.catchUp ?? {});
  // Each ranked list reveals PAGE_STEP rows at a time ("Show more"); the caption only says "complete"
  // when the server echoed the limit and sent fewer rows than asked (an older server just sends its fixed top list).
  const [shown, setShown] = useState<Record<string, number>>({});
  const rows = <T,>(key: string, list: T[]) => {
    const st = listState(list.length, shown[key] ?? PAGE_STEP, FULL_LIMIT, d?.limit);
    return { st, items: list.slice(0, st.visible) };
  };
  const more = (key: string, st: ReturnType<typeof listState>) =>
    st.hidden > 0 ? (
      <Tappable onPress={() => setShown((m) => ({ ...m, [key]: st.visible + PAGE_STEP }))}>
        <Card style={{ alignItems: "center" }}><Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 14 }}>Show {st.nextStep} more · {st.hidden} hidden</Text></Card>
      </Tappable>
    ) : null;

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={styles.title}>Today in full</Text>
      <Hint>{d ? `${formatShortDate(d.asOfDate)} disclosures` : "Every signal, streak, divergence and sector move"}{category !== "all" ? ` · ${category === "active-equity" ? "Active Equity" : "Option-Income"} funds` : " · all funds"}{snapshotSpan(d ?? {}) ? ` · Δ ${snapshotSpan(d ?? {})}` : ""}</Hint>
      {stale ? <StaleBanner text={stale} /> : null}
      {catchUp.length > 0 && (
        <Note>Catching up from stale data, so their daily moves are withheld: {catchUp.map(([f, s]) => `${f}${s ? ` (since ${formatShortDate(s)})` : ""}`).join(", ")}.</Note>
      )}
      <QueryStatus q={q} />
      {d && <KpiGrid items={kpis(d.stats)} />}

      {d && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {TABS.map((t) => <Chip key={t.value} label={t.label} on={tab === t.value} onPress={() => setTab(t.value)} />)}
          </View>

          {tab === "buys" && (() => {
            const { st, items } = rows("buys", d.signals.buying);
            return (
              <>
                <Hint>{coverageText("buying signals", st, FULL_LIMIT)} Active weight, percentage points.</Hint>
                {st.total === 0 && <Card><Note>No buying signals in this category for the latest data.</Note></Card>}
                {items.map((s, i) => <SignalDetailCard key={s.ticker} s={s} rank={i + 1} />)}
                {more("buys", st)}
              </>
            );
          })()}
          {tab === "sells" && (() => {
            const { st, items } = rows("sells", d.signals.selling);
            return (
              <>
                <Hint>{coverageText("selling signals", st, FULL_LIMIT)} Active weight, percentage points.</Hint>
                {st.total === 0 && <Card><Note>No selling signals in this category for the latest data.</Note></Card>}
                {items.map((s, i) => <SignalDetailCard key={s.ticker} s={s} rank={i + 1} />)}
                {more("sells", st)}
              </>
            );
          })()}
          {tab === "briefing" && (() => {
            const tb = rows("tb", d.briefing.topBuys), ts = rows("ts", d.briefing.topSells);
            const cf = rows("cf", d.briefing.crossFundConvergence), sk = rows("sk", d.briefing.activeStreaks);
            return (
            <>
              <SectionHeader title="Top buys" right={<Hint>{tb.st.total}</Hint>} />
              <Hint>{coverageText("top buys", tb.st, FULL_LIMIT)}</Hint>
              {tb.items.map((s, i) => <SignalDetailCard key={`tb-${s.ticker}`} s={s} rank={i + 1} />)}
              {tb.st.total === 0 && <Card><Note>None.</Note></Card>}
              {more("tb", tb.st)}
              <SectionHeader title="Top sells" right={<Hint>{ts.st.total}</Hint>} />
              <Hint>{coverageText("top sells", ts.st, FULL_LIMIT)}</Hint>
              {ts.items.map((s, i) => <SignalDetailCard key={`ts-${s.ticker}`} s={s} rank={i + 1} />)}
              {ts.st.total === 0 && <Card><Note>None.</Note></Card>}
              {more("ts", ts.st)}
              <SectionHeader title="Multi-provider" right={<Hint>{cf.st.total}</Hint>} />
              <Hint>{coverageText("multi-provider signals", cf.st, FULL_LIMIT)}</Hint>
              {cf.st.total === 0 && <Card><Note>No cross-provider signals.</Note></Card>}
              {cf.items.map((s, i) => <SignalDetailCard key={`cf-${s.ticker}`} s={s} rank={i + 1} />)}
              {more("cf", cf.st)}
              <SectionHeader title="Active streaks" right={<Hint>{sk.st.total}</Hint>} />
              <Hint>{coverageText("streaks (3+ days)", sk.st, FULL_LIMIT)}</Hint>
              <Card style={{ paddingVertical: spacing.xs }}>
                {sk.st.total === 0 && <Note>No active streaks.</Note>}
                {sk.items.map((x) => <StreakRow key={`${x.fund}-${x.ticker}`} s={x} />)}
              </Card>
              {more("sk", sk.st)}
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
            );
          })()}
          {tab === "divergences" && (
            <>
              <Hint>{d.divergences.length} {plural(d.divergences.length, "stock")} where one side of the book is buying and another selling.</Hint>
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
