import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { FundOptionBookCard } from "@/components/options/StructureViews";
import { Badge, Card, ErrorNote, Hint, Loading, Note, Screen, StatTile, Tappable } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useOptionStructures } from "@/lib/options/queries";
import { display, fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** Every tracked fund's option legs on one stock: held structures, changes since the compare date, every leg. */
export default function OptionStructuresScreen() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { symbol: raw } = useLocalSearchParams<{ symbol: string }>();
  const symbol = String(raw ?? "").toUpperCase();
  const q = useOptionStructures(symbol);
  const notFound = q.error instanceof ApiError && q.error.status === 404;

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md }}>
        <Text style={styles.symbol}>{symbol}</Text>
        <Text style={styles.sub}>option structures</Text>
      </View>
      {q.isLoading && <Loading />}
      {notFound && <Card><Note>No tracked fund holds options on {symbol}.</Note></Card>}
      {q.isError && !notFound && <ErrorNote message="Couldn't load option structures." onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><StatTile label="Funds" value={String(q.data.fundCount)} /></View>
            <View style={{ flex: 1 }}><StatTile label="Open legs" value={String(q.data.legCount)} /></View>
            <View style={{ flex: 1 }}><StatTile label="Paired" value={q.data.pairedPct == null ? "—" : `${Math.round(q.data.pairedPct)}%`} /></View>
          </View>
          <Hint>
            {q.data.tradedLegs} {q.data.tradedLegs === 1 ? "leg" : "legs"} changed since each fund's previous file; {q.data.pairedLegs} of them pair into a roll, spread, synthetic, collar or other combination. As of {q.data.asOfDate}.
          </Hint>
          {q.data.funds.map((b) => <FundOptionBookCard key={b.fund} book={b} underlying={q.data!.underlying} />)}
          <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(symbol)}`)}>
            <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 }}>Stock view for {symbol}</Text>
              <Badge label="OPEN" color={c.accent} />
            </Card>
          </Tappable>
        </>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    symbol: { ...display, color: c.textPrimary, fontSize: 44, lineHeight: 48 },
    sub: { color: c.textMuted, fontFamily: fonts.body, fontSize: 15, paddingBottom: 8 },
  });
