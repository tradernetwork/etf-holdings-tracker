import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, FreshnessLabel, Hint, Mono } from "@/components/ui";
import { freshnessLabel } from "@/lib/format";
import type { RotationData } from "@/lib/fundExtras";
import { currentBars, groupColor, hexAlpha, maxCell, rotationTitle, sortedGroups } from "@/lib/rotation";
import { fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** ULTI/ULTY rotation: allocation bars, weekly drift heatmap, added/dropped/held names, churn, unmapped. */
export function RotationView({ d }: { d: RotationData }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const groups = sortedGroups(d);
  const peak = maxCell(d);
  const churn = d.churnSincePrior;
  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text style={styles.title}>{rotationTitle(d)}</Text>
          <Hint>{d.holdings} holdings · as of {d.asOf}</Hint>
        </View>
        {/* The same freshness label used on the rest of the fund screen: an older report is an older disclosure, never "no change". */}
        <FreshnessLabel freshness={freshnessLabel({ stale: d.stale, date: d.asOf })} />
        <Text style={styles.blurb}>{d.blurb}</Text>
        {currentBars(d).map(({ group, weight }) => (
          <View key={group} style={styles.barRow}>
            <Text style={styles.barLabel} numberOfLines={1}>{group}</Text>
            <View style={styles.track}><View style={{ width: `${Math.min(100, weight * 2)}%`, height: 10, borderRadius: 4, backgroundColor: groupColor(group, groups) }} /></View>
            <Mono style={{ width: 40, textAlign: "right", fontSize: 12 }}>{weight.toFixed(0)}%</Mono>
          </View>
        ))}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.small}>WEEKLY DRIFT</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={{ flexDirection: "row", marginLeft: 120 }}>
              {d.dates.map((dt) => <Text key={dt} style={styles.dateHead}>{dt.slice(5).replace("-", "/")}</Text>)}
            </View>
            {groups.map((g) => (
              <View key={g} style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                <Text style={styles.rowLabel} numberOfLines={1}>{g}</Text>
                {d.timeline.map((cell) => {
                  const w = cell.weights[g] || 0;
                  return (
                    <View key={cell.date} accessibilityLabel={w > 0 ? `${g} ${cell.date}: ${w.toFixed(1)}%` : undefined} style={[styles.cell, { backgroundColor: w > 0 ? hexAlpha(groupColor(g, groups), 0.15 + 0.85 * (w / peak)) : c.border }]} />
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.small}>CHURN SINCE PRIOR · {churn.rate.toFixed(0)}% of names changed</Text>
        <NameList label="Added" names={churn.added} color={c.buy} />
        <NameList label="Dropped" names={churn.dropped} color={c.sell} />
        <NameList label="Held" names={churn.held} color={c.textSecondary} />
        {d.unmapped && d.unmapped.length > 0 ? <NameList label="Not yet categorised" names={d.unmapped} color={c.textMuted} /> : null}
      </Card>
    </View>
  );
}

function NameList({ label, names, color }: { label: string; names: string[]; color: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.small}>{label.toUpperCase()} ({names.length})</Text>
      <Text style={{ color, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 }}>{names.length ? names.join("  ") : "none"}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    blurb: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },
    small: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1 },
    barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    barLabel: { width: 112, color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    track: { flex: 1, height: 10, borderRadius: 4, backgroundColor: c.border },
    dateHead: { width: 22, color: c.textMuted, fontFamily: fonts.body, fontSize: 7, textAlign: "center" },
    rowLabel: { width: 120, color: c.textSecondary, fontFamily: fonts.body, fontSize: 10 },
    cell: { width: 20, height: 18, marginRight: 2, borderRadius: 3 },
  });
