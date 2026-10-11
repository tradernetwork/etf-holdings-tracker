import { StyleSheet, Text, View } from "react-native";
import { Badge, Card, Hint, Mono, ThinBar } from "@/components/ui";
import { gradeTone, scoreTone, type MetricCard, type PeerComparison, type Tone } from "@/lib/effectiveness";
import { display, fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

export function toneColor(t: Tone, c: Palette): string {
  return { good: c.buy, ok: c.accent, warn: c.isNew, bad: c.sell, none: c.textMuted }[t];
}

/** Grade + composite score header. */
export function GradeHeader({ grade, score, description }: { grade: string; score: number | null; description: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const col = toneColor(gradeTone(grade), c);
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
      <View style={[styles.grade, { borderColor: col, backgroundColor: col + "22" }]}><Text style={[styles.gradeText, { color: col }]}>{grade}</Text></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.score}>{score == null ? "—" : score.toFixed(1)}<Text style={styles.of}> / 100</Text></Text>
        <Hint>{description}</Hint>
      </View>
    </Card>
  );
}

/** One metric: score bar, every labelled row, a distribution bar and any detail list. */
export function MetricBlock({ m }: { m: MetricCard }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const col = toneColor(scoreTone(m.score), c);
  const total = (m.bars ?? []).reduce((a, b) => a + b.value, 0);
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={styles.title}>{m.title}</Text>
        <Mono bold style={{ fontSize: 18, color: col }}>{m.score == null ? "—" : Math.round(m.score)}</Mono>
      </View>
      <ThinBar fraction={(m.score ?? 0) / 100} color={col} height={5} />
      <Hint>{m.blurb}</Hint>
      {m.rows.map(([label, value]) => (
        <View key={label} style={styles.kv}>
          <Text style={styles.k}>{label}</Text>
          <Mono style={{ fontSize: 12 }}>{value}</Mono>
        </View>
      ))}
      {m.bars && total > 0 ? (
        <View style={{ gap: 4 }}>
          <View style={styles.dist}>
            {m.bars.map((b, i) => b.value > 0 ? <View key={b.label} style={{ flex: b.value, backgroundColor: DIST_COLORS(c)[i % 4] }} /> : null)}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md }}>
            {m.bars.map((b, i) => (
              <View key={b.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={[styles.sw, { backgroundColor: DIST_COLORS(c)[i % 4] }]} />
                <Hint>{b.label}: {b.value}</Hint>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {(m.lists ?? []).map((l) => (
        <View key={l.title} style={{ gap: 3 }}>
          <Text style={styles.listTitle}>{l.title.toUpperCase()}</Text>
          {l.lines.map((line, i) => <Text key={i} style={styles.listLine}>{line}</Text>)}
        </View>
      ))}
    </Card>
  );
}
const DIST_COLORS = (c: Palette) => [c.buy, c.accent, c.isNew, c.sell];

export function FactsCard({ facts, weights }: { facts: [string, string][]; weights: string[] }) {
  const styles = useStyles(makeStyles);
  return (
    <Card style={{ gap: 4 }}>
      {facts.map(([k, v]) => (
        <View key={k} style={styles.kv}><Text style={styles.k}>{k}</Text><Mono style={{ fontSize: 12 }}>{v}</Mono></View>
      ))}
      <Text style={[styles.listTitle, { marginTop: spacing.sm }]}>SCORE WEIGHTS</Text>
      <Text style={styles.listLine}>{weights.join("  ·  ")}</Text>
    </Card>
  );
}

export function PeerCard({ pc, fund }: { pc: PeerComparison; fund: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.title}>Peer comparison <Text style={styles.of}> rank {pc.rank} of {pc.total}</Text></Text>
      {pc.metrics.map((m) => (
        <View key={m.label} style={styles.kv}>
          <Text style={styles.k}>{m.label}</Text>
          <Mono style={{ fontSize: 12 }}>{m.score == null ? "—" : Math.round(m.score)} · rank {m.rank || "—"} · best {m.best == null ? "—" : Math.round(m.best)}</Mono>
        </View>
      ))}
      <Text style={styles.listTitle}>RANKING (COMPOSITE)</Text>
      {pc.ranking.map((r, i) => (
        <View key={r.fund} style={styles.kv}>
          <Text style={[styles.k, r.isCurrent && { color: c.accent, fontFamily: fonts.bodyBold }]}>{i + 1}. {r.fund}{r.fund === fund ? " (this fund)" : ""}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Badge label={r.grade} color={toneColor(gradeTone(r.grade), c)} />
            <Mono style={{ fontSize: 12 }}>{r.score == null ? "—" : r.score.toFixed(1)}</Mono>
          </View>
        </View>
      ))}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    grade: { width: 64, height: 64, borderRadius: radii.card, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    gradeText: { ...display, fontSize: 34, letterSpacing: -1 },
    score: { ...display, color: c.textPrimary, fontSize: 30, letterSpacing: -1 },
    of: { color: c.textMuted, fontFamily: fonts.body, fontSize: 12, letterSpacing: 0 },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, minHeight: 24 },
    k: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13, flexShrink: 1 },
    dist: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: c.border },
    sw: { width: 8, height: 8, borderRadius: 2 },
    listTitle: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1 },
    listLine: { color: c.textSecondary, fontFamily: fonts.mono, fontSize: 11, lineHeight: 16 },
  });
