import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { Badge, Card, ErrorNote, Hint, Loading, Mono, Note } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import {
  activityLines, buildBook, optionExtrasOf, optionSubtitle, optionTitle, rowsFromFundPayload, sideLabel, sortGroups, sortLegs, sortStocks,
  valueText, type AllocKey, type Bucket, type Book, type OptionGroup, type OptionLine, type SortKey, type StockLine,
} from "@/lib/book";
import { catchUpOf, changesForFund } from "@/lib/derive";
import { cleanName, formatCount, formatPp, formatShares, formatShortDate, formatUsd, formatWeight, freshnessLabel, fundAumUsd } from "@/lib/format";
import { useFund, useFundBook } from "@/lib/queries";
import { deltaColor, display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const STOCKS_COLLAPSED = 25;

type SectionKey = "stocks" | "options" | "buckets";
type Item =
  | { t: "stock"; line: StockLine }
  | { t: "more"; total: number; open: boolean }
  | { t: "ogroup"; group: OptionGroup }
  | { t: "oleg"; line: OptionLine }
  | { t: "activity"; lines: string[] }
  | { t: "bucket"; bucket: Bucket; open: boolean }
  | { t: "bline"; name: string; valueText: string; weight: number }
  | { t: "empty"; text: string };
interface Section { key: SectionKey; title: string; data: Item[] }

const SEGMENT_SECTION: Record<AllocKey, SectionKey> = {
  stocks: "stocks", optionsLong: "options", optionsShort: "options", treasury: "buckets", cash: "buckets", swap: "buckets",
};

export default function FundScreen() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { fund: raw } = useLocalSearchParams<{ fund: string }>();
  const symbol = String(raw ?? "").toUpperCase();
  const q = useFund(symbol);
  const bookQ = useFundBook(symbol);
  const { isFollowing, toggleFollow } = useAppState();

  const [stockSort, setStockSort] = useState<SortKey>("value");
  const [optionSort, setOptionSort] = useState<SortKey>("expiry");
  const [showAllStocks, setShowAllStocks] = useState(false);
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(new Set());
  const listRef = useRef<SectionList<Item, Section>>(null);

  const f = q.data;
  // Full book from the server when it can filter; otherwise the partial book rebuilt from /fund/{fund}.
  const partial = !!f && !bookQ.isLoading && !bookQ.data;
  const rows = useMemo(() => {
    const raw = bookQ.data ? bookQ.data.holdings : f ? rowsFromFundPayload(f) : [];
    // A stale or catch-up fund has no honest one-day change: show "—", never "no change".
    return f && (f.stale || catchUpOf(f).active) ? raw.map((r) => ({ ...r, weightDelta: null, sharesDelta: null })) : raw;
  }, [bookQ.data, f]);
  const book: Book | null = useMemo(() => {
    if (!f) return null;
    const active = new Map(changesForFund(f.recentChanges, f.fund).map((ch) => [ch.ticker, ch.activeWeightDelta as number | null]));
    return buildBook(rows, { asOfDate: f.asOfDate, fundAumBillions: f.aum, activeDeltaByTicker: active, optionExtras: optionExtrasOf(f) });
  }, [rows, f]);

  const sections = useMemo<Section[]>(() => {
    if (!book || !f) return [];
    const out: Section[] = [];
    if (book.stocks.length > 0) {
      const sorted = sortStocks(book.stocks, stockSort);
      const shown = showAllStocks ? sorted : sorted.slice(0, STOCKS_COLLAPSED);
      const data: Item[] = shown.map((line) => ({ t: "stock", line }));
      if (sorted.length > STOCKS_COLLAPSED) data.push({ t: "more", total: sorted.length, open: showAllStocks });
      out.push({ key: "stocks", title: "Stocks", data });
    }
    if (book.optionGroups.length > 0) {
      const data: Item[] = [];
      for (const g of sortGroups(book.optionGroups, optionSort)) {
        data.push({ t: "ogroup", group: g });
        for (const line of sortLegs(g.lines, optionSort)) data.push({ t: "oleg", line });
      }
      const act = activityLines(f);
      if (act.length > 0) data.push({ t: "activity", lines: act });
      out.push({ key: "options", title: "Options", data });
    }
    if (book.buckets.length > 0) {
      const data: Item[] = [];
      for (const b of book.buckets) {
        const open = openBuckets.has(b.sleeve);
        data.push({ t: "bucket", bucket: b, open });
        if (open) for (const l of b.lines) data.push({ t: "bline", name: cleanName(l.name), valueText: valueText(l.value), weight: l.weight });
      }
      out.push({ key: "buckets", title: "Cash & treasuries", data });
    }
    return out;
  }, [book, f, stockSort, optionSort, showAllStocks, openBuckets]);

  if (q.isLoading) return <View style={styles.root}><Loading /></View>;
  if (q.isError || !f || !book) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <View style={[styles.root, { padding: spacing.lg }]}>
        {notFound ? (
          <Card><Text style={styles.symbol}>{symbol}</Text><Note>{symbol} isn&apos;t a fund we track.</Note></Card>
        ) : (
          <ErrorNote message="Couldn't load this fund." onRetry={() => q.refetch()} />
        )}
      </View>
    );
  }

  const catchUp = catchUpOf(f);
  const aum = fundAumUsd(f);
  const income = f.category === "option-income";
  const fresh = freshnessLabel({ stale: f.stale, date: f.holdingsDate });
  const jumpTo = (key: AllocKey) => {
    const idx = sections.findIndex((s) => s.key === SEGMENT_SECTION[key]);
    if (idx < 0) return;
    listRef.current?.scrollToLocation({ sectionIndex: idx, itemIndex: 0, viewPosition: 0, viewOffset: 8, animated: true });
  };
  const toggleBucket = (k: string) => setOpenBuckets((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{income ? "INCOME & OPTIONS" : "STOCK ACTIVITY"}</Text>
          <Text style={styles.symbol}>{f.fund}</Text>
          <Text style={styles.provider}>{f.provider} · {income ? "Option-Income" : "Active Equity"}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.total}>{formatUsd(aum)}</Text>
          <Hint>total value (AUM)</Hint>
          <View style={{ marginTop: 4 }}><FreshLine text={fresh.text} stale={fresh.stale} /></View>
        </View>
      </View>

      <FollowButton symbol={symbol} following={isFollowing("fund", symbol)} onToggle={() => toggleFollow("fund", symbol)} />

      {catchUp.active ? (
        <Banner title={catchUp.since ? `Catch-up since ${formatShortDate(catchUp.since)}` : "Catch-up"} body="Changes over that gap aren't shown as one day: this fund's previous file was carried forward, so the latest diff spans several days." />
      ) : null}
      {f.stale ? (
        <Banner
          title={`Older disclosure · ${formatShortDate(f.holdingsDate)}`}
          body={`The ${formatShortDate(f.asOfDate)} snapshot carries this book forward. These positions are not fresh trade signals. Quiet data is not proof of no trades.`}
        />
      ) : null}
      {partial ? (
        <Note>
          {f.topHoldings.length > 0 ? `Showing the top ${f.topHoldings.length} stocks and every option leg. The full book (all stocks, cash and Treasuries)` : "Showing every option leg. The full book (stocks, cash and Treasuries)"} appears once the server update is live.
        </Note>
      ) : null}

      <AllocationBar book={book} onPress={jumpTo} />
      {book.expiredHidden > 0 ? <Hint>{book.expiredHidden} expired option {book.expiredHidden === 1 ? "leg is" : "legs are"} hidden.</Hint> : null}
    </View>
  );

  return (
    <SectionList<Item, Section>
      ref={listRef}
      style={styles.root}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl }}
      sections={sections}
      keyExtractor={(item, i) => itemKey(item, i)}
      ListHeaderComponent={header}
      stickySectionHeadersEnabled={false}
      initialNumToRender={20}
      windowSize={7}
      onScrollToIndexFailed={() => {}}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); bookQ.refetch(); }} tintColor={c.accent} />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.key === "stocks" ? (
            <SortChips value={stockSort} onChange={setStockSort} options={STOCK_SORTS} />
          ) : section.key === "options" ? (
            <SortChips value={optionSort} onChange={setOptionSort} options={OPTION_SORTS} />
          ) : null}
        </View>
      )}
      renderItem={({ item }) => {
        switch (item.t) {
          case "stock": return <StockRow line={item.line} />;
          case "more": return <MoreRow total={item.total} open={item.open} onPress={() => setShowAllStocks((v) => !v)} />;
          case "ogroup": return <OptionGroupHeader group={item.group} />;
          case "oleg": return <OptionRow line={item.line} />;
          case "activity": return <ActivityBox lines={item.lines} />;
          case "bucket": return <BucketRow bucket={item.bucket} open={item.open} onPress={() => toggleBucket(item.bucket.sleeve)} />;
          case "bline": return <BucketLineRow name={item.name} valueText={item.valueText} weight={item.weight} />;
          case "empty": return <Note>{item.text}</Note>;
        }
      }}
      ListEmptyComponent={bookQ.isLoading ? <Loading /> : <Card><Note>No positions reported for this fund.</Note></Card>}
    />
  );
}

const itemKey = (item: Item, i: number): string => {
  switch (item.t) {
    case "stock": return item.line.key;
    case "oleg": return item.line.key;
    case "ogroup": return `g:${item.group.underlying}`;
    case "bucket": return `bk:${item.bucket.sleeve}`;
    default: return `${item.t}:${i}`;
  }
};

const STOCK_SORTS: { value: SortKey; label: string }[] = [
  { value: "value", label: "Value" }, { value: "weight", label: "%" }, { value: "change", label: "Today" },
];
const OPTION_SORTS: { value: SortKey; label: string }[] = [
  { value: "expiry", label: "Expiry" }, { value: "value", label: "Value" }, { value: "weight", label: "%" }, { value: "change", label: "Today" },
];

// ---- pieces ---------------------------------------------------------------------

function FreshLine({ text, stale }: { text: string; stale: boolean }) {
  const c = useTheme();
  if (!text) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {stale && <Ionicons name="time-outline" size={12} color={c.stale} />}
      <Text style={{ color: c.stale, fontSize: 11, fontFamily: fonts.body }}>{text}</Text>
    </View>
  );
}

function Banner({ title, body }: { title: string; body: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.warn}>
      <Ionicons name="time-outline" size={20} color={c.warnText} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.warnTitle}>{title}</Text>
        <Text style={styles.warnBody}>{body}</Text>
      </View>
    </View>
  );
}

function FollowButton({ symbol, following, onToggle }: { symbol: string; following: boolean; onToggle: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${following ? "Unfollow" : "Follow"} ${symbol}`}
      accessibilityState={{ selected: following }}
      style={[styles.follow, following && { backgroundColor: c.accent + "22", borderColor: c.accent }]}
    >
      <Ionicons name={following ? "star" : "star-outline"} size={15} color={following ? c.accent : c.textSecondary} />
      <Text style={[styles.followText, following && { color: c.accent }]}>{following ? "Following" : "Follow"}</Text>
    </Pressable>
  );
}

function segColor(key: AllocKey, c: Palette): string {
  return { stocks: c.accent, optionsLong: c.buy, optionsShort: c.isNew, treasury: c.textSecondary, cash: c.textMuted, swap: c.sell }[key];
}

function AllocationBar({ book, onPress }: { book: Book; onPress: (k: AllocKey) => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const total = book.allocation.reduce((a, s) => a + Math.abs(s.weight), 0);
  if (total <= 0) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.cardTitle}>Allocation</Text>
      <View style={styles.bar} accessibilityRole="image" accessibilityLabel="Allocation by position type">
        {book.allocation.map((s) => (
          <Pressable key={s.key} onPress={() => onPress(s.key)} accessibilityRole="button" accessibilityLabel={`${s.label} ${formatWeight(s.weight)}`} style={{ flex: Math.max(Math.abs(s.weight) / total, 0.01), backgroundColor: segColor(s.key, c) }} />
        ))}
      </View>
      <View style={styles.legend}>
        {book.allocation.map((s) => (
          <Pressable key={s.key} onPress={() => onPress(s.key)} accessibilityRole="button" style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: segColor(s.key, c) }]} />
            <Text style={styles.legendText}>{s.label}</Text>
            <Mono style={{ fontSize: 12, color: s.weight < 0 ? c.isNew : c.textPrimary }}>{formatWeight(s.weight)}</Mono>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function SortChips({ value, onChange, options }: { value: SortKey; onChange: (k: SortKey) => void; options: { value: SortKey; label: string }[] }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.sortRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.sortChip, on && { backgroundColor: c.border }]}>
            <Text style={[styles.sortText, on && { color: c.textPrimary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StockRow({ line }: { line: StockLine }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const known = line.sharesDelta !== null || line.activeDelta !== null;
  const color = deltaColor(line.activeDelta ?? line.sharesDelta, c);
  return (
    <Pressable onPress={() => router.push(`/ticker/${encodeURIComponent(line.ticker)}`)} accessibilityRole="button" style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{line.ticker}</Text>
        <Hint>{line.shares > 0 ? `${formatCount(line.shares)} shares` : cleanName(line.name)}</Hint>
        {line.shares > 0 ? <Hint style={{ opacity: 0.8 }}>{line.name}</Hint> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14 }}>{valueText(line.value)}</Mono>
        <Hint>{formatWeight(line.weight)} of fund</Hint>
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: known ? color : c.textMuted }}>
          {known ? [line.sharesDelta !== null && line.sharesDelta !== 0 ? `${formatShares(line.sharesDelta)} sh` : null, line.activeDelta !== null && line.activeDelta !== 0 ? formatPp(line.activeDelta) : null].filter(Boolean).join(" · ") || "no change" : "—"}
        </Text>
      </View>
    </Pressable>
  );
}

function MoreRow({ total, open, onPress }: { total: number; open: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: MIN_TAP, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>{open ? "Show fewer" : `Show all ${formatCount(total)} stocks`}</Text>
    </Pressable>
  );
}

function OptionGroupHeader({ group }: { group: OptionGroup }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.groupHead}>
      <Text style={styles.groupTitle}>{group.underlying}</Text>
      <Hint>{group.lines.length} {group.lines.length === 1 ? "leg" : "legs"}{group.underlyingPrice !== null ? ` · last $${group.underlyingPrice.toFixed(2)}` : ""}</Hint>
      <View style={{ flex: 1 }} />
      <Mono bold style={{ fontSize: 13 }}>{group.valueUsd === null ? "—" : formatUsd(group.valueUsd)}</Mono>
      <Hint style={{ width: 62, textAlign: "right" }}>{formatWeight(group.weight)}</Hint>
    </View>
  );
}

function OptionRow({ line }: { line: OptionLine }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const dc = line.contractsDelta;
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle}>{optionTitle(line.underlying, line.type, line.strike)}</Text>
        <Hint>{optionSubtitle(line.expiry, line.dte, line.flex)}</Hint>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Badge label={line.short ? "SHORT" : "LONG"} color={line.short ? c.isNew : c.accent} />
          <Hint>{sideLabel(line.contracts).replace(/^(Long|Short) · /, "")}</Hint>
          {line.chip ? <Badge label={line.chip.label} color={line.chip.label === "ITM" ? c.buy : c.textMuted} /> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14, color: line.value.usd !== null && line.value.usd < 0 ? c.isNew : c.textPrimary }}>{valueText(line.value)}</Mono>
        <Hint>{formatWeight(line.weight)} of fund</Hint>
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: dc === null || dc === 0 ? c.textMuted : deltaColor(dc, c) }}>
          {dc === null ? "—" : dc === 0 ? "no change" : `${formatShares(dc)} ct`}
        </Text>
      </View>
    </View>
  );
}

function ActivityBox({ lines }: { lines: string[] }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.activity}>
      <Text style={styles.cardTitle}>Activity</Text>
      {lines.slice(0, 5).map((l) => <Text key={l} style={styles.activityLine}>{l}</Text>)}
    </View>
  );
}

function BucketRow({ bucket, open, onPress }: { bucket: Bucket; open: boolean; onPress: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{bucket.label}</Text>
        <Hint>{bucket.lines.length} {bucket.lines.length === 1 ? "line" : "lines"}</Hint>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14 }}>{bucket.valueUsd === null ? "—" : formatUsd(bucket.valueUsd)}</Mono>
        <Hint>{formatWeight(bucket.weight)} of fund</Hint>
      </View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
    </Pressable>
  );
}

function BucketLineRow({ name, valueText: v, weight }: { name: string; valueText: string; weight: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.bline}>
      <Text style={styles.blineName} numberOfLines={1}>{name}</Text>
      <Mono style={{ fontSize: 12 }}>{v}</Mono>
      <Hint style={{ width: 56, textAlign: "right" }}>{formatWeight(weight)}</Hint>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.canvas },
    eyebrow: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4 },
    symbol: { ...display, color: c.textPrimary, fontSize: 48, lineHeight: 52, marginTop: spacing.xs },
    provider: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    total: { ...display, color: c.textPrimary, fontSize: 28, letterSpacing: -1 },
    follow: {
      flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: MIN_TAP, paddingHorizontal: spacing.md,
      borderWidth: 1, borderColor: c.border, borderRadius: radii.pill, backgroundColor: c.card,
    },
    followText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
    warn: { flexDirection: "row", gap: spacing.md, backgroundColor: c.warnBg, borderColor: c.warnBorder, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg },
    warnTitle: { color: c.warnText, fontFamily: fonts.bodyBold, fontSize: 14 },
    warnBody: { color: c.warnText, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
    cardTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 },
    bar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2, backgroundColor: c.border },
    legend: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: 2 },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
    legendText: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.xs, backgroundColor: c.canvas },
    sectionTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18 },
    sortRow: { flexDirection: "row", gap: 2 },
    sortChip: { minHeight: 32, paddingHorizontal: 10, justifyContent: "center", borderRadius: radii.pill },
    sortText: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomColor: c.border, borderBottomWidth: 1, minHeight: MIN_TAP + 10 },
    rowTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
    groupHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs, borderBottomColor: c.border, borderBottomWidth: 1 },
    groupTitle: { ...display, color: c.textPrimary, fontSize: 20, letterSpacing: -0.5 },
    activity: { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg, gap: 4, marginTop: spacing.md },
    activityLine: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    bline: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingLeft: spacing.md, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
    blineName: { flex: 1, color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  });
