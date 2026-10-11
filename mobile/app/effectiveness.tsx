import { useMemo, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { LeaderRow, MetricChips, openFundScores } from "@/components/effectiveness/BoardParts";
import { Card, ErrorNote, Hint, Loading, Note, Screen, SectionHeader, StatTile } from "@/components/ui";
import { toneColor } from "@/components/fund/effectiveness-view";
import {
  BOARD_METRICS, BOARD_SHARE_URL, boardShareText, boardSummary, LIMITATIONS, METHODOLOGY, rankFunds, type BoardMetric,
} from "@/lib/effectiveness-board";
import { gradeTone } from "@/lib/effectiveness";
import { usePeers } from "@/lib/fundQueries";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** Strategy Effectiveness: every scored option-income fund, side by side, ranked by the metric you pick. */
export default function EffectivenessScreen() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const q = usePeers(true);
  const [metric, setMetric] = useState<BoardMetric>("composite");
  const [method, setMethod] = useState(false);
  const funds = q.data?.funds ?? [];
  const ranked = useMemo(() => rankFunds(funds, metric), [funds, metric]);
  const s = useMemo(() => boardSummary(funds), [funds]);
  const label = BOARD_METRICS.find((m) => m.key === metric)!.label;

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={styles.title}>Strategy effectiveness</Text>
      <Hint>How well does each option-income ETF execute its stated strategy? {funds.length > 0 ? `All ${funds.length} funds` : "Every fund"} scored side by side with prospectus-calibrated metrics.</Hint>

      {q.isLoading && <Loading />}
      {q.isError && <ErrorNote message="Couldn't load the effectiveness scores." onRetry={() => q.refetch()} />}

      {q.data && funds.length > 0 && (
        <>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><StatTile label="Funds scored" value={String(s.graded)} /></View>
            <View style={{ flex: 1 }}><StatTile label="Avg composite" value={s.averageComposite == null ? "—" : s.averageComposite.toFixed(1)} /></View>
            <View style={{ flex: 1 }}><StatTile label="Hedged by mandate" value={String(s.hedgingMandated)} /></View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {["A", "B", "C", "D", "F", "N/A"].filter((g) => s.byGrade[g]).map((g) => (
              <View key={g} style={[styles.gradePill, { borderColor: toneColor(gradeTone(g), c) }]}>
                <Text style={{ color: toneColor(gradeTone(g), c), fontFamily: fonts.bodyBold, fontSize: 12 }}>{g} · {s.byGrade[g]}</Text>
              </View>
            ))}
            <Hint>{s.peerGroups.length} peer {s.peerGroups.length === 1 ? "group" : "groups"}{s.asOfDate ? ` · as of ${s.asOfDate}` : ""}{s.staleFunds > 0 ? ` · ${s.staleFunds} on stale data` : ""}</Hint>
          </View>
          <Pressable
            onPress={() => Share.share({ message: `${boardShareText(funds.length)}\n${BOARD_SHARE_URL}`, url: BOARD_SHARE_URL })}
            accessibilityRole="button"
            style={styles.share}
          >
            <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 13 }}>Share this ranking ↗</Text>
          </Pressable>

          <SectionHeader title="Side-by-side comparison" right={<Hint>ranked by {label.toLowerCase()}</Hint>} />
          <MetricChips value={metric} onChange={setMetric} />
          {ranked.map((f, i) => <LeaderRow key={f.fund} f={f} rank={i + 1} metric={metric} onPress={() => openFundScores(f.fund)} />)}
        </>
      )}
      {q.data && funds.length === 0 && <Card><Note>No funds scored yet.</Note></Card>}

      <Pressable onPress={() => setMethod((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: method }} style={styles.methodHead}>
        <Text style={styles.methodTitle}>Scoring methodology</Text>
        <Text style={{ color: c.textMuted, fontSize: 14 }}>{method ? "▴" : "▾"}</Text>
      </Pressable>
      {method && (
        <>
          {METHODOLOGY.map((m) => (
            <Card key={m.title} style={{ gap: 4 }}>
              <Text style={styles.methodTitle}>{m.title}</Text>
              <Text style={styles.methodText}>{m.text}</Text>
            </Card>
          ))}
          <Card style={{ gap: spacing.sm }}>
            <Text style={styles.methodTitle}>Limitations & disclaimers</Text>
            {LIMITATIONS.map((l) => <Text key={l} style={styles.methodText}>• {l}</Text>)}
          </Card>
        </>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { color: c.textPrimary, ...display, fontSize: 30 },
    gradePill: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 10, minHeight: 26, justifyContent: "center" },
    share: { minHeight: MIN_TAP, justifyContent: "center" },
    methodHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: MIN_TAP, marginTop: spacing.md },
    methodTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    methodText: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },
  });
