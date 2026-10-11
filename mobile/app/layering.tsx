import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Chip } from "@/components/options/parts";
import { LayeringCard } from "@/components/today/Parts";
import { Card, ErrorNote, Hint, Loading, Note, Screen } from "@/components/ui";
import { useLayeringFull } from "@/lib/today/queries";
import { display, fonts, type Palette } from "@/lib/theme";
import { useStyles } from "@/lib/theme-context";

const WINDOWS = [5, 7, 10, 14, 30];
const MIN_FUNDS = [2, 3, 4, 5];

/** Consensus / layering: independent funds opening the same brand-new position within a few trading days. */
export default function LayeringScreen() {
  const styles = useStyles(makeStyles);
  const [windowDays, setWindowDays] = useState(7);
  const [minFunds, setMinFunds] = useState(3);
  const q = useLayeringFull(windowDays, minFunds);
  const d = q.data;
  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={styles.title}>Consensus</Text>
      <Hint>Layering is independent funds opening the same brand-new position within {windowDays} trading days. Higher strength means more funds, more families and more AUM, scaled against the strongest active pattern.</Hint>
      <Text style={styles.label}>WINDOW (TRADING DAYS)</Text>
      <View style={styles.row}>{WINDOWS.map((w) => <Chip key={w} label={`${w}`} on={windowDays === w} onPress={() => setWindowDays(w)} />)}</View>
      <Text style={styles.label}>AT LEAST THIS MANY FUNDS</Text>
      <View style={styles.row}>{MIN_FUNDS.map((m) => <Chip key={m} label={`${m}+`} on={minFunds === m} onPress={() => setMinFunds(m)} />)}</View>

      {q.isLoading && <Loading />}
      {q.isError && <ErrorNote message="Couldn't load layering patterns." onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Hint>{d.total} {d.total === 1 ? "pattern" : "patterns"} in the last {d.windowDays} trading days with {d.minFunds}+ funds · as of {d.asOfDate}{d.patterns.length < d.total ? ` · showing ${d.patterns.length}` : ""}</Hint>
          {d.patterns.length === 0 && (
            <Card><Note>No layering patterns in the last {windowDays} trading days with {minFunds}+ funds. Try a wider window or fewer funds, or check back after the next scrape.</Note></Card>
          )}
          {d.patterns.map((p, i) => <LayeringCard key={p.ticker} p={p} rank={i + 1} />)}
          <Hint>Not financial advice: a map of where institutional money is quietly clustering. Combined AUM is the funds' total size, not capital invested in this stock; entry positions are estimates (weight x latest AUM).</Hint>
        </>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { color: c.textPrimary, ...display, fontSize: 30 },
    label: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginTop: 4 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  });
