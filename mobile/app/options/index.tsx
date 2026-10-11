import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ActivityRow } from "@/components/options/ActivityRow";
import { ListingScanCard } from "@/components/options/ListingScanCard";
import { ScheduleCard } from "@/components/options/ScheduleCard";
import { TotalTile, ViewAll } from "@/components/options/parts";
import { Card, ErrorNote, Hint, Loading, Note, Screen, SectionHeader } from "@/components/ui";
import { activityTitle } from "@/lib/when";
import { useStats } from "@/lib/stats";
import { ApiError } from "@/lib/api";
import { sortActivity } from "@/lib/options/logic";
import { useMwfSchedule, useOptionActivity, useOptionListings } from "@/lib/options/queries";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const PREVIEW = 5;
const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

/** Options hub: a preview of each option screen, every one with a real "View all". */
export default function OptionsHub() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const activity = useOptionActivity("daily");
  const stats = useStats();
  const listings = useOptionListings();
  const schedule = useMwfSchedule();
  const [symbol, setSymbol] = useState("");
  const top = useMemo(() => sortActivity(activity.data?.optionsActivity ?? []).slice(0, PREVIEW), [activity.data]);
  const total = activity.data?.optionsActivity.length ?? 0;
  const sym = symbol.trim().toUpperCase();
  const go = () => SYMBOL.test(sym) && router.push(`/options/${encodeURIComponent(sym)}`);
  const refreshing = activity.isRefetching || listings.isRefetching || schedule.isRefetching;

  return (
    <Screen
      topInset={false}
      refreshing={refreshing}
      onRefresh={() => { activity.refetch(); listings.refetch(); schedule.refetch(); }}
    >
      <Text style={styles.title}>Options</Text>
      <Hint>What the funds did with option contracts, what CBOE just listed, and when the weekly expirations fall.</Hint>

      <View style={styles.search}>
        <Ionicons name="search" size={18} color={c.textMuted} />
        <TextInput
          value={symbol}
          onChangeText={setSymbol}
          placeholder="Option structures for a stock, e.g. MSTR"
          placeholderTextColor={c.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={go}
          style={styles.input}
        />
        {SYMBOL.test(sym) && (
          <Pressable onPress={go} accessibilityRole="button" hitSlop={8}><Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>Go</Text></Pressable>
        )}
      </View>

      <SectionHeader title={activityTitle(stats.data?.asOfDate)} right={<ViewAll label={total > 0 ? `View all ${total}` : "Windows & filters"} onPress={() => router.push("/options/activity")} />} />
      {activity.isLoading && <Loading />}
      {activity.isError && <ErrorNote message="Couldn't load option activity." onRetry={() => activity.refetch()} />}
      {activity.data && (
        <Card style={{ paddingVertical: spacing.xs }}>
          {top.length === 0 ? (
            <Note>No option contracts changed in the latest files. Try the 7-day or 30-day window.</Note>
          ) : (
            top.map((r, i) => <ActivityRow key={`${r.fund}-${r.ticker}-${i}`} record={r} />)
          )}
        </Card>
      )}

      <SectionHeader title="New option listings (CBOE)" right={<ViewAll label="View all scans" onPress={() => router.push("/options/listings")} />} />
      {listings.isLoading && <Loading />}
      {listings.isError && <ErrorNote message="Couldn't load the CBOE scan." onRetry={() => listings.refetch()} />}
      {listings.data?.latest && (
        <>
          <View style={styles.tiles}>
            <TotalTile icon="pulse" value={listings.data.latest.totals.allOptionable} label="Optionable stocks" blurb="The full universe with at least one options contract on CBOE." />
            <TotalTile icon="business" value={listings.data.latest.totals.weeklyEtfs} label="Weekly ETFs" blurb="ETFs approved for weekly expirations." />
            <TotalTile icon="trending-up" value={listings.data.latest.totals.weeklyEquities} label="Weekly equities" blurb="Stocks approved for weekly expirations." />
          </View>
          <ListingScanCard scan={listings.data.latest} category="all" search="" />
        </>
      )}
      {listings.data && !listings.data.latest && <Card><Note>No scan history yet. The scanner runs each weekday morning.</Note></Card>}

      <SectionHeader title="MWF Elite schedule" right={<ViewAll label="Calendar & holidays" onPress={() => router.push("/options/schedule")} />} />
      {schedule.isLoading && <Loading />}
      {schedule.data && <ScheduleCard schedule={schedule.data} />}
      {schedule.error instanceof ApiError && schedule.error.status === 404 && (
        <Card><Note>This server doesn't publish the expiration schedule yet. It will appear after the next API update.</Note></Card>
      )}
      {schedule.isError && !(schedule.error instanceof ApiError && schedule.error.status === 404) && (
        <ErrorNote message="Couldn't load the schedule." onRetry={() => schedule.refetch()} />
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { color: c.textPrimary, ...display, fontSize: 30 },
    search: {
      flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TAP, backgroundColor: c.card,
      borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md,
    },
    input: { flex: 1, color: c.textPrimary, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0, minHeight: MIN_TAP },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  });
