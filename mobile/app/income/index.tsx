import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FundCard } from "@/components/income/DirectoryParts";
import { Card, ErrorNote, Hint, Loading, Note, Screen, Tappable } from "@/components/ui";
import { formatAsOfLong, groupByArchetype, SORT_OPTIONS, type DirectorySort } from "@/lib/incomeDirectory";
import { useIncomeDirectory } from "@/lib/incomeDirectoryQueries";
import { dayWord } from "@/lib/when";
import { formatPutCall, useStats } from "@/lib/stats";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** Premium Sellers: the website's /income, grouped by what each income fund structurally is. */
export default function IncomeDirectory() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const q = useIncomeDirectory();
  const stats = useStats();
  const pc = formatPutCall(stats.data?.putCallRatio);
  const [archetype, setArchetype] = useState("all");
  const [sort, setSort] = useState<DirectorySort>("aum");
  const all = useMemo(() => (q.data ? groupByArchetype(q.data) : []), [q.data]);
  const sections = useMemo(() => (q.data ? groupByArchetype(q.data, { archetype, sort }) : []), [q.data, archetype, sort]);

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={styles.title}>Premium Sellers</Text>
      <Text style={styles.lede}>
        Funds that sell options for income. Their stock book churns by design — it's collateral for the overlay, not conviction — so none of the conviction scoring on the stock-picker side applies here. The option book is the story.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" }}>
        {q.data ? <Hint>{formatAsOfLong(q.data.asOfDate)} · {q.data.fundCount} funds · {q.data.archetypes.length} distinct structures</Hint> : <View />}
        {pc ? <View style={styles.pc} accessibilityLabel={`Put call ratio ${pc}`}><Text style={styles.pcLabel}>P/C Ratio</Text><Text style={styles.pcValue}>{pc}</Text></View> : null}
      </View>

      <Tappable onPress={() => router.push("/options/activity?category=option-income")}>
        <Card><Text style={styles.link}>Option activity · income funds →</Text><Hint>Contracts the income funds opened, closed and rolled in the {dayWord(q.data?.asOfDate)} file, by provider.</Hint></Card>
      </Tappable>

      {q.isLoading && <Loading />}
      {q.isError && <ErrorNote message="Couldn't load the income directory." onRetry={() => q.refetch()} />}

      {q.data && (
        <>
          <Card style={{ gap: spacing.xs }}>
            <Text style={styles.cardTitle}>"Income ETF" is not one thing</Text>
            <Text style={styles.body}>
              These funds get lumped together because they all pay a big distribution, but structurally they have almost nothing in common. One owns 27 stocks and writes calls on them. Another owns no shares at all — just Treasuries and an options structure. A third writes contracts that expire before the day ends, so they never show up in a holdings file. Grouped by what they actually are:
            </Text>
          </Card>

          <View style={styles.chips}>
            <Chip label="All" on={archetype === "all"} onPress={() => setArchetype("all")} />
            {all.map((s) => <Chip key={s.key} label={`${s.label.split(/ [—+] /)[0]} · ${s.funds.length}`} on={archetype === s.key} onPress={() => setArchetype(s.key)} />)}
          </View>
          <View style={styles.chips}>
            <Text style={styles.sortLabel}>Sort</Text>
            {SORT_OPTIONS.map((o) => <Chip key={o.value} label={o.label} on={sort === o.value} onPress={() => setSort(o.value)} />)}
          </View>

          {sections.length === 0 && <Note>No income funds in this structure.</Note>}
          {sections.map((s) => (
            <View key={s.key} style={{ gap: spacing.sm }}>
              <View style={[styles.secHead, { borderLeftColor: c.isNew }]}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" }}>
                  <Text style={styles.secTitle}>{s.label}</Text>
                  <Hint>{s.funds.length} {s.funds.length === 1 ? "fund" : "funds"}</Hint>
                </View>
                {s.summary ? <Text style={styles.body}>{s.summary}</Text> : null}
              </View>
              {s.funds.map((f) => <FundCard key={f.fund} f={f} />)}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && { backgroundColor: c.accent + "22", borderColor: c.accent }]}>
      <Text style={[styles.chipText, on && { color: c.accent }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { ...display, color: c.textPrimary, fontSize: 30 },
    lede: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
    link: { color: c.accent, fontFamily: fonts.bodyBold, fontSize: 15 },
    cardTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 },
    body: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
    sortLabel: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginRight: 4 },
    chip: { minHeight: MIN_TAP - 8, paddingHorizontal: 12, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
    chipText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 12 },
    secHead: { borderLeftWidth: 2, paddingLeft: spacing.md, gap: 4, marginTop: spacing.md },
    pc: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: radii.pill, paddingHorizontal: 10, minHeight: 28 },
    pcLabel: { color: c.textMuted, fontFamily: fonts.body, fontSize: 12 },
    pcValue: { color: c.textPrimary, fontFamily: fonts.monoBold, fontSize: 13 },
    secTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16, flexShrink: 1 },
  });
