import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { ListingScanCard } from "@/components/options/ListingScanCard";
import { Chip, ShowMore, TotalTile } from "@/components/options/parts";
import { Card, Hint, Note, Screen, SectionHeader, Tappable, QueryStatus } from "@/components/ui";
import { CAT_OPTIONS, visibleScans, type CatFilter } from "@/lib/options/logic";
import { useOptionListings } from "@/lib/options/queries";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const SCANS_CAP = 5;

/** The CBOE Options Scanner: universe totals, the dated scan timeline, category + search filters, the MWF link. */
export default function ListingsScreen() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const q = useOptionListings();
  const [category, setCategory] = useState<CatFilter>("all");
  const [search, setSearch] = useState("");
  const [allScans, setAllScans] = useState(false);
  const history = q.data?.history ?? [];
  const latest = q.data?.latest ?? null;
  const shown = useMemo(() => visibleScans(history, category, search), [history, category, search]);
  const filterActive = category !== "all" || search.trim() !== "";
  const list = allScans ? shown : shown.slice(0, SCANS_CAP);

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={styles.title}>CBOE options scanner</Text>
      <Hint>A daily diff of CBOE's published option universe: stocks gaining options for the first time, and weekly-options promotions or demotions. Refreshed each weekday morning. Standalone CBOE market data, the same for everyone.</Hint>

      <QueryStatus q={q} />

      {latest && (
        <View style={styles.tiles}>
          <TotalTile icon="pulse" value={latest.totals.allOptionable} label="All optionable stocks" blurb="The full universe of US-listed equities with at least one options contract on CBOE, not a filtered list." />
          <TotalTile icon="business" value={latest.totals.weeklyEtfs} label="Weekly ETFs" blurb="ETFs approved for weekly options expirations: more liquidity and tighter spreads than monthly-only products." />
          <TotalTile icon="trending-up" value={latest.totals.weeklyEquities} label="Weekly equities" blurb="Individual stocks approved for weekly options expirations, promoted once they have enough volume and open interest." />
        </View>
      )}

      <Tappable onPress={() => router.push("/options/schedule")}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Ionicons name="flame" size={20} color={c.isNew} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>MWF Elite expiration schedule</Text>
            <Hint>Today's status, the next expiration day, holidays and the 12 symbols</Hint>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Card>
      </Tappable>

      {q.data && history.length === 0 && (
        <Card><Note>No scan history yet. The scanner runs automatically each weekday morning; check back after the next run.</Note></Card>
      )}

      {history.length > 0 && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {CAT_OPTIONS.map((o) => <Chip key={o.value} label={o.label} on={category === o.value} onPress={() => setCategory(o.value)} />)}
          </View>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={c.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Filter by ticker or name…"
              placeholderTextColor={c.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
            />
          </View>
          <SectionHeader title={filterActive ? `${shown.length} matching ${shown.length === 1 ? "scan" : "scans"}` : `Last ${history.length} ${history.length === 1 ? "scan" : "scans"}`} />
          {shown.length === 0 ? (
            <Card><Note>No scans match that filter. Try a different category or clear the search.</Note></Card>
          ) : (
            list.map((s) => <ListingScanCard key={s.date} scan={s} category={category} search={search} />)
          )}
          <ShowMore total={shown.length} shown={SCANS_CAP} open={allScans} onPress={() => setAllScans((v) => !v)} />
        </>
      )}

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.linkTitle}>How it works</Text>
        <Hint><Text style={{ fontFamily: fonts.bodyBold, color: c.textSecondary }}>Newly optionable</Text>: stocks that just got options listed for the first time.</Hint>
        <Hint><Text style={{ fontFamily: fonts.bodyBold, color: c.textSecondary }}>Weekly ETFs</Text>: ETFs gaining or losing weekly options expirations.</Hint>
        <Hint><Text style={{ fontFamily: fonts.bodyBold, color: c.textSecondary }}>Weekly equities</Text>: stocks promoted to (or removed from) weekly options.</Hint>
        <Hint>Data comes from CBOE's Symbol Directory and Available Weeklys lists. Tap any ticker to open its cross-fund view.</Hint>
      </Card>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { color: c.textPrimary, ...display, fontSize: 30 },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    linkTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    search: {
      flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TAP, backgroundColor: c.card,
      borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md,
    },
    input: { flex: 1, color: c.textPrimary, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0, minHeight: MIN_TAP },
  });
