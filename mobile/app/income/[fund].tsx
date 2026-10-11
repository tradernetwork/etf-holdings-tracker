import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Tile, toneColor } from "@/components/income/DirectoryParts";
import { Action } from "@/components/discovery-ui";
import { Card, ErrorNote, Hint, Loading, Mono, Note, Screen, SectionHeader, Tappable } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useIncomeFund } from "@/lib/fundQueries";
import { formatAsOfLong } from "@/lib/incomeDirectory";
import {
  bookRowView, COV_NOTE, detailTiles, hasIncomeDetail, INVISIBLE_DETAIL_TITLE, invisibleDetailBody, netAssetsLabel, notionalLine, ROOM_NOTE, sleeveBar, SUPPRESSED_NOTE,
  type BookRowView,
} from "@/lib/incomeDetail";
import { display, fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** /income/{fund} on the website: what kind of fund, six coverage tiles, what backs it, one row per underlying. */
export default function IncomeFundDetail() {
  const styles = useStyles(makeStyles);
  const { fund: raw } = useLocalSearchParams<{ fund: string }>();
  const fund = String(raw ?? "").toUpperCase();
  const q = useIncomeFund(fund, true);

  if (q.isLoading) return <Screen topInset={false}><Loading /></Screen>;
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Screen topInset={false}>
        {notFound ? <Card><Text style={styles.title}>{fund}</Text><Note>{fund} isn't an option-income fund we analyse. Open its fund page instead.</Note><Action onPress={() => router.replace(`/fund/${encodeURIComponent(fund)}`)}>Full fund profile →</Action></Card>
          : <ErrorNote message="Couldn't load this income fund." onRetry={() => q.refetch()} />}
      </Screen>
    );
  }
  const d = q.data;
  if (!hasIncomeDetail(d)) {
    return <Screen topInset={false}><Card><Text style={styles.title}>{fund}</Text><Note>This server doesn't return the income analysis yet. The fund page still has the full book.</Note><Action onPress={() => router.replace(`/fund/${encodeURIComponent(fund)}`)}>Full fund profile →</Action></Card></Screen>;
  }

  const bar = sleeveBar(d.sleeves);
  const notional = notionalLine(d.tiles);
  const rows = d.book.map((r) => bookRowView(r, d.asOfDate));
  const anySuppressed = rows.some((r) => r.spotSuppressed);

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flexWrap: "wrap" }}>
          <Text style={styles.title}>{d.fund}</Text>
          <Text style={styles.provider}>{d.provider}</Text>
        </View>
        <Hint>{formatAsOfLong(d.asOfDate)}{netAssetsLabel(d)}</Hint>
      </View>
      <View style={styles.arch}>
        <Text style={styles.archTitle}>{d.archetypeLabel}</Text>
        <Text style={styles.body}>{d.archetypeSummary}</Text>
      </View>

      {d.incomeLegVisible === false && (
        <Card style={{ gap: spacing.xs }}>
          <Text style={styles.warnTitle}>{INVISIBLE_DETAIL_TITLE}</Text>
          <Text style={styles.body}>{invisibleDetailBody(d.fund)}</Text>
        </Card>
      )}

      <View style={styles.grid}>
        {detailTiles(d.tiles).map((t) => <Tile key={t.label} label={t.label} value={t.value} sub={t.sub} tone={t.tone} />)}
      </View>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.cardTitle}>What backs the fund</Text>
        <SleeveBarView bar={bar} sleeves={d.sleeves.optionsShort} />
        {notional ? <Hint>{notional}</Hint> : null}
      </Card>

      <SectionHeader title="The book" />
      <Hint>{d.book.length} {d.book.length === 1 ? "underlying" : "underlyings"} · {d.counts.optionLegs} contracts collapsed to one row each</Hint>
      {rows.length === 0 ? (
        <Card><Note>No option positions in the latest snapshot for {d.fund}.</Note></Card>
      ) : (
        rows.map((r) => <BookRowCard key={r.underlying} r={r} />)
      )}
      <Hint>{ROOM_NOTE}</Hint>
      <Hint>{COV_NOTE}{anySuppressed ? ` ${SUPPRESSED_NOTE}` : ""}</Hint>

      <View style={{ flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" }}>
        <Action onPress={() => router.replace("/income")}>← All Premium Sellers</Action>
        <Action onPress={() => router.push(`/fund/${encodeURIComponent(d.fund)}`)}>Full fund profile →</Action>
      </View>
    </Screen>
  );
}

function SleeveBarView({ bar, sleeves }: { bar: ReturnType<typeof sleeveBar>; sleeves: number }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const color = (k: string) => ({ equity: c.accent, treasury: c.textSecondary, cash: c.textMuted, swap: c.sell, optionsLong: c.buy }[k] ?? c.textMuted);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.bar} accessibilityRole="image" accessibilityLabel="Fund composition by sleeve">
        {bar.positive.map((s) => <View key={s.key} style={{ flex: Math.max(s.share, 0.01), backgroundColor: color(s.key) }} />)}
      </View>
      {bar.short ? (
        <View style={styles.shortTrack} accessibilityLabel={`Written options ${bar.short.value.toFixed(2)}% of NAV`}>
          <View style={{ width: `${Math.max(bar.short.share * 100, 2)}%`, height: 10, borderRadius: 5, backgroundColor: c.isNew }} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: 2 }}>
        {bar.positive.map((s) => (
          <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={[styles.dot, { backgroundColor: color(s.key) }]} />
            <Text style={styles.legend}>{s.label} {s.value.toFixed(1)}%</Text>
          </View>
        ))}
        {bar.short ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={[styles.dot, { backgroundColor: c.isNew }]} />
            <Text style={styles.legend}>Written options {sleeves.toFixed(2)}%</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Cell({ label, value, color, note }: { label: string; value: string; color?: string; note?: string | null }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Mono style={{ fontSize: 13, color }}>{value}</Mono>
      {note ? <Text style={styles.cellNote}>{note}</Text> : null}
    </View>
  );
}

function BookRowCard({ r }: { r: BookRowView }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(r.underlying)}`)}>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text style={styles.cardTitle}>{r.underlying}</Text>
          <Hint>{r.legCount} {r.legCount === 1 ? "leg" : "legs"}</Hint>
        </View>
        <View style={styles.cells}>
          <Cell label="% NAV" value={r.nav} />
          <Cell label="Shares" value={r.shares} />
          <Cell label="Spot" value={r.spot} color={r.spotSuppressed ? c.isNew : undefined} />
          <Cell label="Strike" value={r.strike} color={r.capped ? c.sell : undefined} />
          <Cell label="DTE" value={r.dte} note={r.dteNote} />
          <Cell label="Room" value={r.room} color={toneColor(r.roomTone, c)} />
          <Cell label="Cov" value={r.covered} />
        </View>
        <Hint>Long legs: {r.longLegs}</Hint>
      </Card>
    </Tappable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { ...display, color: c.textPrimary, fontSize: 34 },
    provider: { color: c.textMuted, fontFamily: fonts.body, fontSize: 14 },
    arch: { borderLeftWidth: 2, borderLeftColor: c.isNew, paddingLeft: spacing.md, gap: 4 },
    archTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    body: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
    warnTitle: { color: c.isNew, fontFamily: fonts.bodyBold, fontSize: 14 },
    cardTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    bar: { flexDirection: "row", height: 22, borderRadius: radii.card, overflow: "hidden", gap: 1, backgroundColor: c.border },
    shortTrack: { flexDirection: "row", height: 10 },
    dot: { width: 8, height: 8, borderRadius: 2 },
    legend: { color: c.textSecondary, fontFamily: fonts.mono, fontSize: 11 },
    cells: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.sm },
    cell: { minWidth: 64, gap: 1 },
    cellNote: { color: c.textMuted, fontFamily: fonts.body, fontSize: 9 },
    cellLabel: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  });
