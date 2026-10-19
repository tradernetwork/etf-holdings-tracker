import { Ionicons } from "@expo/vector-icons";
import { pluralize } from "@/lib/format";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Card, Hint, Mono, Tappable } from "@/components/ui";
import {
  cappedTone, dteSub, formatAum, INVISIBLE_INCOME_LEG, moneynessSub, moneynessTone, pct, signedPct,
  type IncomeDirectoryFund, type IncomeSleeves, type Tone,
} from "@/lib/incomeDirectory";
import { fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

export function toneColor(t: Tone, c: Palette): string {
  return { muted: c.textMuted, sell: c.sell, income: c.isNew, buy: c.buy, plain: c.textPrimary }[t];
}

export function Tile({ label, value, sub, tone = "plain" }: { label: string; value: string; sub?: string; tone?: Tone }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ""}`}>
      <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
      <Mono bold style={{ fontSize: 17, color: toneColor(tone, c) }}>{value}</Mono>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

const SLEEVE_LABELS: { key: keyof IncomeSleeves; label: string }[] = [
  { key: "equity", label: "Stocks" },
  { key: "treasury", label: "Treasuries" },
  { key: "cash", label: "Cash" },
  { key: "swap", label: "Swaps" },
  { key: "optionsLong", label: "Long options" },
  { key: "optionsShort", label: "Written options" },
];

/** Signed sleeves as a share of net assets: written options subtract, so the row can sum past or under 100%. Zero sleeves are left out. */
export function SleeveLine({ sleeves }: { sleeves: IncomeSleeves }) {
  const c = useTheme();
  const shown = SLEEVE_LABELS.filter((s) => Math.abs(sleeves[s.key] ?? 0) >= 0.05);
  if (shown.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: 2 }}>
      {shown.map((s) => (
        <Text key={s.key} style={{ color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 }}>
          {s.label} <Text style={{ fontFamily: fonts.mono, color: sleeves[s.key] < 0 ? c.isNew : c.textPrimary }}>{signedPct(sleeves[s.key])}</Text>
        </Text>
      ))}
    </View>
  );
}

/** One fund in the directory, linking to the fund screen. Same four tiles and invisible-income-leg warning as the website. */
export function FundCard({ f }: { f: IncomeDirectoryFund }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const t = f.tiles;
  const aum = formatAum(f.aum);
  return (
    <Tappable onPress={() => router.push(`/income/${encodeURIComponent(f.fund)}`)}>
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" }}>
          <Text style={styles.fund}>
            {f.fund} <Text style={styles.provider}>{f.provider}</Text>
            {aum ? <Text style={styles.provider}>  {aum}</Text> : null}
          </Text>
          <Hint>{f.counts.underlyings} {f.counts.underlyings === 1 ? "underlying" : "underlyings"} · {pluralize(f.counts.optionLegs, "leg")}</Hint>
        </View>
        {f.incomeLegVisible ? (
          <View style={styles.grid}>
            <Tile label="Call coverage" value={pct(t.callCoveragePct)} sub="of equity sleeve" />
            <Tile label="Wtd moneyness" value={pct(t.weightedMoneynessPct, 2)} sub={moneynessSub(t.weightedMoneynessPct)} tone={moneynessTone(t.weightedMoneynessPct)} />
            <Tile label="Wtd DTE" value={t.weightedDte === null ? "—" : `${t.weightedDte.toFixed(1)}d`} sub={dteSub(t.weightedDte)} />
            <Tile label="Capped" value={`${t.cappedNames}/${t.namesWithWrittenCalls}`} sub="already past strike" tone={cappedTone(t)} />
          </View>
        ) : (
          <View style={styles.warn}>
            <Ionicons name="eye-off-outline" size={18} color={c.isNew} style={{ marginTop: 1 }} />
            <Text style={styles.warnText}>{INVISIBLE_INCOME_LEG}</Text>
          </View>
        )}
        <SleeveLine sleeves={f.sleeves} />
      </Card>
    </Tappable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fund: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18, flexShrink: 1 },
    provider: { color: c.textMuted, fontFamily: fonts.body, fontSize: 13 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    tile: { flexGrow: 1, flexBasis: "45%", backgroundColor: c.canvas, borderColor: c.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.md, gap: 2 },
    tileLabel: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1 },
    tileSub: { color: c.textMuted, fontFamily: fonts.body, fontSize: 11 },
    warn: { flexDirection: "row", gap: spacing.sm, backgroundColor: c.warnBg, borderColor: c.warnBorder, borderWidth: 1, borderRadius: radii.card, padding: spacing.md },
    warnText: { flex: 1, color: c.warnText, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },
  });
