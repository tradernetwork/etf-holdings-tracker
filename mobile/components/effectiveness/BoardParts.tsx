import { router } from "expo-router";
import { pluralize } from "@/lib/format";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { toneColor } from "@/components/fund/effectiveness-view";
import { Badge, Card, Hint, Mono, Tappable } from "@/components/ui";
import { BOARD_METRICS, firstSentence, metricScore, type BoardMetric } from "@/lib/effectiveness-board";
import { gradeTone, scoreTone } from "@/lib/effectiveness";
import type { Effectiveness } from "@/lib/fundExtras";
import { fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** The metric selector: its choice drives ranking and which column is highlighted. */
export function MetricChips({ value, onChange }: { value: BoardMetric; onChange: (m: BoardMetric) => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {BOARD_METRICS.map((m) => {
        const on = m.key === value;
        return (
          <Pressable
            key={m.key}
            onPress={() => onChange(m.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && { backgroundColor: c.accent + "22", borderColor: c.accent }]}
          >
            <Text style={[styles.chipText, on && { color: c.accent }]}>{m.short}{on ? " ▼" : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const SEVEN: BoardMetric[] = ["strike", "dte", "spread", "roll", "premium", "hedge", "concentration"];

/** One fund in the leaderboard: rank, grade + composite, peer group, hedged chip, strategy line, all seven scores. */
export function LeaderRow({ f, rank, metric, onPress }: { f: Effectiveness; rank: number; metric: BoardMetric; onPress: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const gcol = toneColor(gradeTone(f.grade), c);
  return (
    <Tappable onPress={onPress}>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Mono style={{ fontSize: 13, color: c.textMuted, width: 26 }}>#{rank}</Mono>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.fund}>{f.fund}</Text>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <Hint>{f.peerGroup}</Hint>
              {f.hedgingMandated ? <Badge label="HEDGED" color={c.buy} /> : null}
              {f.dataStale ? <Badge label="STALE" color={c.stale} /> : null}
            </View>
          </View>
          <View style={{ alignItems: "center", gap: 2 }}>
            <View style={[styles.grade, { borderColor: gcol, backgroundColor: gcol + "22" }]}><Text style={[styles.gradeText, { color: gcol }]}>{f.grade}</Text></View>
            <Mono style={{ fontSize: 12, color: gcol }}>{f.compositeScore ?? "—"}</Mono>
          </View>
        </View>
        {f.strategyDescription ? <Text style={styles.strategy} numberOfLines={2}>{firstSentence(f.strategyDescription)}</Text> : null}
        <View style={styles.scores}>
          {SEVEN.map((m) => {
            const s = metricScore(f, m);
            const col = toneColor(scoreTone(s), c);
            const on = m === metric;
            return (
              <View key={m} style={[styles.cell, on && { borderColor: c.accent, backgroundColor: c.accent + "14" }]}>
                <Mono bold style={{ fontSize: 14, color: col }}>{s == null ? "—" : Math.round(s)}</Mono>
                <Text style={styles.cellLabel}>{BOARD_METRICS.find((x) => x.key === m)!.short}</Text>
              </View>
            );
          })}
        </View>
        <Hint>{pluralize(f.optionsCount, "position")} · {pluralize(f.historyDepth, "day")} of history · {f.asOfDate}{f.dataStale ? " · stale" : ""}</Hint>
      </Card>
    </Tappable>
  );
}

export const openFundScores = (fund: string) => router.push({ pathname: "/fund/[fund]", params: { fund, tab: "scores" } });

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, justifyContent: "center" },
    chipText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 12 },
    fund: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18 },
    grade: { minWidth: 40, height: 34, paddingHorizontal: 8, borderRadius: radii.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
    gradeText: { fontFamily: fonts.bodyBold, fontSize: 18 },
    strategy: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
    scores: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    cell: { minWidth: 44, flexGrow: 1, alignItems: "center", paddingVertical: 4, borderRadius: radii.sm, borderWidth: 1, borderColor: "transparent" },
    cellLabel: { color: c.textMuted, fontFamily: fonts.body, fontSize: 9 },
  });
