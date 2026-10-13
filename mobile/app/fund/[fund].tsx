import { Action } from "@/components/discovery-ui";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { columnStyle } from "@/lib/layout";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import { ActivityNote, DayHeader, OptionChangeRow, RollCard, TradeRow } from "@/components/fund/activity-rows";
import {
  ActivityBox, AllocationBar, Banner, BucketLineRow, BucketRow, FollowButton, FreshLine, MoreRow, OptionGroupHeader, OptionRow, SortChips, StockRow,
} from "@/components/fund/book-rows";
import { ChangeRow, StreakRow } from "@/components/fund/changes-rows";
import { FactsCard, GradeHeader, MetricBlock, PeerCard } from "@/components/fund/effectiveness-view";
import { ExpiryHeader, FundHasOptions, IncomeSummary, LegRow, NoticeCard, OtherPositionRow, PositionCard, SnapshotDate, optionKeyOf } from "@/components/fund/income-rows";
import { RotationView } from "@/components/fund/rotation-view";
import { Card, ErrorNote, Hint, Loading, Mono, Note, Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import {
  activityLines, buildBook, optionExtrasOf, rowsFromFundPayload, sortGroups, sortLegs, sortStocks, valueText,
  type AllocKey, type Book, type Bucket, type OptionGroup as OptGroup, type OptionLine, type SortKey, type StockLine,
} from "@/lib/book";
import { catchUpOf, changesForFund } from "@/lib/derive";
import { activitySummary, formatDay } from "@/lib/activity";
import { metricCards, effectivenessFacts, peerComparison, weightLines } from "@/lib/effectiveness";
import { fundHasOptions } from "@/lib/optionPresence";
import { deltaLabel } from "@/lib/deltaPeriod";
import { formatCount, formatShortDate, formatUsd, formatWeight, freshnessLabel, fundAumUsd } from "@/lib/format";
import { splitPeriod, PERIOD_LABEL } from "@/lib/fundChanges";
import { ROTATION_FUNDS, type ChangePeriod, type IncomePosition, type OptionActivityDay, type OptionTrade, type OtherPosition } from "@/lib/fundExtras";
import { useEffectiveness, useFundChanges, useIncomeFund, usePeers, useRotation } from "@/lib/fundQueries";
import {
  COVERAGE_LABEL, DEFAULT_DIR, deriveRows, incomeNotices, expiryLadder, filterRows, filtersActive, liveLegCount, NO_FILTERS, openedDates, optionOnlyPositions, SORT_LABEL,
  sortRows, sectorsOf, topSector, TOGGLE_LABEL, type Coverage, type PosFilters, type PosSort, type Toggle,
} from "@/lib/incomeBook";
import { useFund, useFundBook } from "@/lib/queries";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { Change, OptionRoll } from "@/lib/types";

const STOCKS_COLLAPSED = 25;
const CHANGES_COLLAPSED = 12;
const RECENT_DAYS = 3;

type Tab = "positions" | "changes" | "activity" | "scores" | "rotation";
type Group = "stock" | "expiry" | "contracts";

type Item =
  | { t: "stock"; line: StockLine }
  | { t: "more"; id: string; total: number; open: boolean; noun: string; onPress: () => void }
  | { t: "ogroup"; group: OptGroup }
  | { t: "oleg"; line: OptionLine }
  | { t: "activity"; lines: string[] }
  | { t: "bucket"; bucket: Bucket; open: boolean }
  | { t: "bline"; name: string; valueText: string; weight: number }
  | { t: "pos"; row: ReturnType<typeof deriveRows>[number] }
  | { t: "posleg"; ticker: string; leg: IncomePosition["legs"][number] }
  | { t: "exp"; expiry: string; dte: number | null; count: number }
  | { t: "other"; o: OtherPosition }
  | { t: "day"; d: OptionActivityDay }
  | { t: "trade"; trade: OptionTrade; id: string }
  | { t: "change"; ch: Change; id: string }
  | { t: "optchange"; ch: Change; id: string }
  | { t: "streak"; s: { ticker: string; days: number; direction: string } }
  | { t: "roll"; roll: OptionRoll; id: string }
  | { t: "node"; id: string; node: ReactNode };
interface Section { key: string; title: string; subtitle?: string; sort?: "stocks" | "options"; data: Item[] }

const TAB_LABEL: Record<Tab, string> = { positions: "Positions", changes: "Changes", activity: "Activity", scores: "Scores", rotation: "Rotation" };

export default function FundScreen() {
  const { width: winWidth } = useWindowDimensions();
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { fund: raw, tab: tabParam } = useLocalSearchParams<{ fund: string; tab?: string }>();
  const symbol = String(raw ?? "").toUpperCase();
  const q = useFund(symbol);
  const f = q.data;
  const income = f?.category === "option-income";
  // What the Δ columns on this screen are measured against (the API's previous snapshot; catch-up / stale funds keep their own wording).
  const span = useMemo(() => (f ? { previousDate: f.previousDate, comparisonTradingDays: f.comparisonTradingDays, stale: f.stale, holdingsDate: f.holdingsDate, catchUp: f.catchUp, catchUpSince: f.catchUpSince } : {}), [f]);
  const { isFollowing, toggleFollow } = useAppState();

  const tabs: Tab[] = useMemo(() => {
    if (!f) return ["positions"];
    const rotation: Tab[] = ROTATION_FUNDS.has(symbol) ? ["rotation"] : [];
    // An income fund with no option legs has no option activity and no strategy scores (the API has none): only its book (and rotation).
    if (income && !fundHasOptions(f)) return ["positions", ...rotation];
    return income ? ["positions", "activity", "scores", ...rotation] : ["positions", "changes"];
  }, [f, income, symbol]);
  // ?tab=scores etc. lets other screens (the effectiveness leaderboard) land on a specific tab.
  const [tab, setTab] = useState<Tab>((["positions", "changes", "activity", "scores", "rotation"] as const).find((t) => t === tabParam) ?? "positions");
  const activeTab: Tab = tabs.includes(tab) ? tab : "positions";

  const bookQ = useFundBook(symbol);
  const incomeQ = useIncomeFund(symbol, !!income);
  const [period, setPeriod] = useState<ChangePeriod>("daily");
  const changesQ = useFundChanges(symbol, period, !!f && !income && activeTab === "changes");
  const effQ = useEffectiveness(symbol, !!income && activeTab === "scores");
  const peersQ = usePeers(!!income && activeTab === "scores");
  const rotQ = useRotation(symbol, !!income && activeTab === "rotation");

  // ---- positions state ----
  const [stockSort, setStockSort] = useState<SortKey>("value");
  const [optionSort, setOptionSort] = useState<SortKey>("expiry");
  const [showAllStocks, setShowAllStocks] = useState(true);
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(new Set());
  // Positions are expanded by default when there are only a few (MSTY has one stock and 16 legs: the legs ARE the book).
  const [toggledPos, setToggledPos] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState<Group>("stock");
  const [filters, setFilters] = useState<PosFilters>(NO_FILTERS);
  const [posSort, setPosSort] = useState<PosSort>("value");
  const [posDir, setPosDir] = useState<"default" | "asc" | "desc">("default");
  const [sheet, setSheet] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // "show all" per list
  const listRef = useRef<SectionList<Item, Section>>(null);

  const partial = !!f && !bookQ.isLoading && !bookQ.data;
  const rows = useMemo(() => {
    const raw2 = bookQ.data ? bookQ.data.holdings : f ? rowsFromFundPayload(f) : [];
    // A stale or catch-up fund has no honest one-day change: show "—", never "no change".
    return f && (f.stale || catchUpOf(f).active) ? raw2.map((r) => ({ ...r, weightDelta: null, activeWeightDelta: null, sharesDelta: null })) : raw2;
  }, [bookQ.data, f]);
  const book: Book | null = useMemo(() => {
    if (!f) return null;
    const active = new Map(changesForFund(f.recentChanges, f.fund).map((ch) => [ch.ticker, ch.activeWeightDelta as number | null]));
    return buildBook(rows, { asOfDate: f.asOfDate, fundAumBillions: f.aum, activeDeltaByTicker: active, optionExtras: optionExtrasOf(f) });
  }, [rows, f]);

  const inc = incomeQ.data;
  // A fund with no option legs at all leaves out the option columns, sections and filters; one leg keeps them all (lib/optionPresence.ts).
  const hasOptions = fundHasOptions(f, inc);
  const incomeBook = !!income && !!inc?.positions && !!inc.positionsSummary;
  const equityChanges = useMemo(() => (f?.recentChanges ?? []).filter((x) => !x.isOption), [f]);
  const posRows = useMemo(() => (incomeBook ? deriveRows(inc!.positions!, equityChanges) : []), [incomeBook, inc, equityChanges]);
  const opened = useMemo(() => openedDates(inc?.optionActivity), [inc]);
  const filtered = useMemo(() => sortRows(filterRows(posRows, filters), posSort, posDir === "default" ? DEFAULT_DIR[posSort] : posDir), [posRows, filters, posSort, posDir]);

  const toggleIn = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n); };

  const sections = useMemo<Section[]>(() => {
    if (!f || !book) return [];
    const out: Section[] = [];
    const bucketItems = (): Item[] => {
      const data: Item[] = [];
      if (book.buckets.length > 0) {
        for (const b of book.buckets) {
          const open = openBuckets.has(b.sleeve);
          data.push({ t: "bucket", bucket: b, open });
          if (open) for (const l of b.lines) data.push({ t: "bline", name: l.name, valueText: valueText(l.value), weight: l.weight });
        }
      } else if (inc?.otherPositions?.length) {
        for (const o of inc.otherPositions) data.push({ t: "other", o });
      }
      return data;
    };
    const contractsSection = (): Section | null => {
      if (book.optionGroups.length === 0) return null;
      const data: Item[] = [];
      for (const g of sortGroups(book.optionGroups, optionSort)) {
        data.push({ t: "ogroup", group: g });
        for (const line of sortLegs(g.lines, optionSort)) data.push({ t: "oleg", line });
      }
      const act = activityLines(f);
      if (act.length > 0) data.push({ t: "activity", lines: act });
      return { key: "options", title: "Option contracts", subtitle: deltaLabel("Δ contracts", span) ?? undefined, sort: "options", data };
    };

    if (activeTab === "positions") {
      if (incomeBook) {
        if (group === "stock") {
          const data: Item[] = filtered.map((row) => ({ t: "pos", row }));
          if (filtered.length === 0) data.push({ t: "node", id: "nomatch", node: <Note>{posRows.length === 0 ? "No stock positions: this fund's book is option legs, T-bills and cash." : "No positions match these filters."}</Note> });
          out.push({ key: "positions", title: hasOptions ? "Stocks & option legs" : "Stocks", subtitle: [`${filtered.length} of ${posRows.length}`, deltaLabel("Δ", span)].filter(Boolean).join(" · "), data });
        } else if (group === "expiry") {
          const ladder = expiryLadder(filtered);
          const data: Item[] = ladder.flatMap((g) => [
            { t: "exp", expiry: g.expiry, dte: g.dte, count: g.legs.length } as Item,
            ...g.legs.map(({ ticker, leg }) => ({ t: "posleg", ticker, leg }) as Item),
          ]);
          if (ladder.length === 0) data.push({ t: "node", id: "nolegs", node: <Note>No live option legs on the filtered positions.</Note> });
          out.push({ key: "ladder", title: "Expiry ladder", subtitle: `${ladder.length} expiries`, data });
        } else {
          const s = contractsSection();
          if (s) out.push(s);
        }
        const optOnly = optionOnlyPositions(inc!.positions!);
        if (optOnly.length > 0 && group !== "contracts") {
          out.push({
            key: "optonly", title: "Options without a stock position",
            data: optOnly.flatMap((p) => p.legs.map((leg) => ({ t: "posleg", ticker: p.ticker, leg }) as Item)),
          });
        }
        const exited = equityChanges.filter((x) => x.type === "REMOVED");
        if (exited.length > 0) {
          out.push({ key: "exited", title: "Exited", data: [{ t: "node", id: "exited", node: <Hint>{exited.map((x) => `${x.ticker} (${formatCount(x.previousShares ?? 0)} sh)`).join(", ")}</Hint> }] });
        }
        const b = bucketItems();
        if (b.length) out.push({ key: "buckets", title: "Cash & treasuries", data: b });
        if (posRows.some((r) => r.p.syntheticShares !== 0)) {
          out.push({ key: "foot", title: "", data: [{ t: "node", id: "foot", node: <Hint>* Includes synthetic shares: a long call and short put at the same strike and expiry, which behaves like owning 100 shares per contract. Market value shows the stock exposure, not the option premium.</Hint> }] });
        }
        return out;
      }
      // Equity funds (and income funds whose /income call failed): the full brokerage book.
      if (book.stocks.length > 0) {
        const sorted = sortStocks(book.stocks, stockSort);
        const shown = showAllStocks ? sorted : sorted.slice(0, STOCKS_COLLAPSED);
        const data: Item[] = shown.map((line) => ({ t: "stock", line }));
        if (sorted.length > STOCKS_COLLAPSED) data.push({ t: "more", id: "stocks", total: sorted.length, open: showAllStocks, noun: "stocks", onPress: () => setShowAllStocks((v) => !v) });
        out.push({ key: "stocks", title: "Stocks", subtitle: deltaLabel("Δ shares and weight", span) ?? undefined, sort: "stocks", data });
      }
      const cs = contractsSection();
      if (cs) out.push(cs);
      const b = bucketItems();
      if (b.length) out.push({ key: "buckets", title: "Cash & treasuries", data: b });
      return out;
    }

    if (activeTab === "changes") {
      if (changesQ.isLoading) return [{ key: "load", title: "", data: [{ t: "node", id: "l", node: <Loading /> }] }];
      if (changesQ.isError || !changesQ.data) return [{ key: "err", title: "", data: [{ t: "node", id: "e", node: <ErrorNote message="Couldn't load changes." onRetry={() => changesQ.refetch()} /> }] }];
      const sp = splitPeriod(changesQ.data.changes);
      const windowLabel = deltaLabel("Changes", { previousDate: changesQ.data.previousDate, comparisonTradingDays: changesQ.data.comparisonTradingDays, catchUp: catchUpOf(f).active, catchUpSince: catchUpOf(f).since });
      if (windowLabel) out.push({ key: "window", title: "", data: [{ t: "node", id: "window", node: <Hint>{windowLabel}</Hint> }] });
      const add = (key: string, title: string, list: Change[]) => {
        if (list.length === 0) return;
        const open = expanded.has(key);
        const data: Item[] = (open ? list : list.slice(0, CHANGES_COLLAPSED)).map((ch, i) => ({ t: "change", ch, id: `${key}${i}${ch.ticker}` }));
        if (list.length > CHANGES_COLLAPSED) data.push({ t: "more", id: key, total: list.length, open, noun: "changes", onPress: () => toggleIn(expanded, key, setExpanded) });
        out.push({ key, title, subtitle: `${list.length}`, data });
      };
      add("entrances", "New entrances", sp.entrances);
      add("exits", "Exits", sp.exits);
      add("increased", "Increased", sp.increased);
      add("trimmed", "Trimmed", sp.trimmed);
      if (sp.unknown > 0) out.push({ key: "unk", title: "", data: [{ t: "node", id: "unk", node: <Hint>{sp.unknown} resized {sp.unknown === 1 ? "position has" : "positions have"} no known change (a catch-up gap is not shown as a one-day move).</Hint> }] });
      if (out.length === 0) out.push({ key: "none", title: "", data: [{ t: "node", id: "none", node: <Note>{f.stale ? `Changes unknown: this fund last disclosed ${formatShortDate(f.holdingsDate)}, so there is no new file to compare. Quiet data is not proof of no trades.` : "No position changes in this window."}</Note> }] });
      const st = f.streaks ?? [];
      if (st.length > 0) {
        const open = expanded.has("streaks");
        const data: Item[] = (open ? st : st.slice(0, 24)).map((s) => ({ t: "streak", s }));
        if (st.length > 24) data.push({ t: "more", id: "streaks", total: st.length, open, noun: "streaks", onPress: () => toggleIn(expanded, "streaks", setExpanded) });
        out.push({ key: "streaks", title: "Streaks", subtitle: `${st.length} active · consecutive-day moves`, data });
      }
      return out;
    }

    if (activeTab === "activity") {
      if (incomeQ.isLoading) return [{ key: "load", title: "", data: [{ t: "node", id: "l", node: <Loading /> }] }];
      const days = inc?.optionActivity ?? [];
      if (days.length > 0) {
        const showOlder = expanded.has("older");
        const shown = showOlder ? days : days.slice(0, RECENT_DAYS);
        const data: Item[] = [];
        for (const d of shown) { data.push({ t: "day", d }); d.trades.forEach((trade, i) => data.push({ t: "trade", trade, id: `${d.date}${i}` })); }
        if (days.length > RECENT_DAYS) data.push({ t: "more", id: "older", total: days.length - RECENT_DAYS, open: showOlder, noun: "earlier days", onPress: () => toggleIn(expanded, "older", setExpanded) });
        data.push({ t: "node", id: "note", node: <ActivityNote /> });
        out.push({ key: "optact", title: "Option activity", subtitle: `${formatDay(days[days.length - 1].compareDate)} – ${formatDay(days[0].date)}`, data: [{ t: "node", id: "sum", node: activitySummary(days).length ? <Hint>{activitySummary(days).join(" · ")}</Hint> : null }, ...data] });
      } else {
        const rolls = f.optionRolls ?? [];
        if (rolls.length > 0) out.push({ key: "rolls", title: "Option rolls", subtitle: "positions rolled, not closed", data: rolls.map((roll, i) => ({ t: "roll", roll, id: `r${i}` })) });
        const optChanges = f.recentChanges.filter((x) => x.isOption);
        out.push({
          key: "optchanges", title: "Option activity", subtitle: `${optChanges.length} contract${optChanges.length === 1 ? "" : "s"}`,
          data: optChanges.length > 0 ? optChanges.map((ch, i) => ({ t: "optchange", ch, id: `o${i}` }) as Item)
            : [{ t: "node", id: "noopt", node: <Note>{catchUpOf(f).active ? `Catch-up since ${formatShortDate(catchUpOf(f).since)}: daily changes are withheld, not shown as one day's trades.` : "No contracts opened or closed today."}</Note> }],
        });
      }
      return out;
    }

    if (activeTab === "scores") {
      if (effQ.isLoading) return [{ key: "load", title: "", data: [{ t: "node", id: "l", node: <Loading /> }] }];
      const e = effQ.data;
      if (effQ.isError || !e) return [{ key: "err", title: "", data: [{ t: "node", id: "e", node: <Note>No effectiveness score is available for {symbol} yet.</Note> }] }];
      const pc = peersQ.data ? peerComparison(peersQ.data.funds, symbol) : null;
      const nodes: Item[] = [
        { t: "node", id: "grade", node: <GradeHeader grade={e.grade} score={e.compositeScore} description={e.strategyDescription} /> },
        { t: "node", id: "facts", node: <FactsCard facts={effectivenessFacts(e)} weights={weightLines(e)} /> },
        ...metricCards(e).map((m) => ({ t: "node", id: m.key, node: <MetricBlock m={m} /> }) as Item),
        ...(pc ? [{ t: "node", id: "peers", node: <PeerCard pc={pc} fund={symbol} /> } as Item] : []),
      ];
      return [{ key: "scores", title: "Strategy effectiveness", data: nodes }];
    }

    if (activeTab === "rotation") {
      if (rotQ.isLoading) return [{ key: "load", title: "", data: [{ t: "node", id: "l", node: <Loading /> }] }];
      // A 404 means the API has no rotation report for this fund (it lists the ones that do): say so, don't offer a retry.
      if (rotQ.error instanceof ApiError && rotQ.error.status === 404) return [{ key: "none", title: "", data: [{ t: "node", id: "n", node: <Note>No rotation report for {symbol}. Reports exist for {Array.from(ROTATION_FUNDS).join(" and ")}.</Note> }] }];
      if (rotQ.isError || !rotQ.data) return [{ key: "err", title: "", data: [{ t: "node", id: "e", node: <ErrorNote message="Couldn't load the rotation report." onRetry={() => rotQ.refetch()} /> }] }];
      return [{ key: "rot", title: "", data: [{ t: "node", id: "rot", node: <RotationView d={rotQ.data} /> }] }];
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, book, activeTab, incomeBook, group, filtered, posRows, inc, equityChanges, stockSort, optionSort, showAllStocks, openBuckets, changesQ.data, changesQ.isLoading, changesQ.isError, span, hasOptions, effQ.data, effQ.isLoading, effQ.isError, peersQ.data, rotQ.data, rotQ.isLoading, rotQ.isError, expanded, incomeQ.isLoading, symbol]);

  if (q.isLoading) return <View style={styles.root}><Loading /></View>;
  if (q.isError || !f || !book) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <View style={[styles.root, { padding: spacing.lg }]}>
        {notFound ? <Card><Text style={styles.symbol}>{symbol}</Text><Note>{symbol} isn&apos;t a fund we track.</Note></Card> : <ErrorNote message="Couldn't load this fund." onRetry={() => q.refetch()} />}
      </View>
    );
  }

  const catchUp = catchUpOf(f);
  const spanLabel = deltaLabel("Δ shares and weight", span);
  const aum = fundAumUsd(f);
  const fresh = freshnessLabel({ stale: f.stale, date: f.holdingsDate });
  const sectionIndexFor = (k: AllocKey): number => {
    const want = k === "stocks" ? ["stocks", "positions", "ladder"] : k === "optionsLong" || k === "optionsShort" ? ["options", "positions", "ladder", "optonly"] : ["buckets"];
    return sections.findIndex((s) => want.includes(s.key));
  };
  const jumpTo = (k: AllocKey) => {
    const idx = sectionIndexFor(k);
    if (idx >= 0) listRef.current?.scrollToLocation({ sectionIndex: idx, itemIndex: 0, viewPosition: 0, viewOffset: 8, animated: true });
  };
  const nFilters = (filters.cov !== "all" ? 1 : 0) + filters.toggles.size + (filters.sector ? 1 : 0);

  const stat = (label: string, value: string, color?: string) => (
    <View key={label} style={styles.statBox}><Text style={styles.statLabel}>{label.toUpperCase()}</Text><Mono bold style={{ fontSize: 15, color }}>{value}</Mono></View>
  );

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
          <View style={{ marginTop: 4, alignItems: "flex-end", gap: 2 }}>
            <FreshLine text={fresh.text} stale={fresh.stale} />
            {f.holdingsDate && f.holdingsDate !== f.asOfDate ? <Hint>issuer file {formatShortDate(f.holdingsDate)}</Hint> : null}
            {f.refreshed === false ? <Hint>not refreshed in the latest snapshot</Hint> : null}
          </View>
        </View>
      </View>

      {spanLabel ? <Hint>{spanLabel}</Hint> : null}
      <View style={styles.stats}>
        {stat("Holdings", formatCount(f.holdingsCount))}
        {income && hasOptions ? stat("Options", formatCount(f.optionsCount)) : null}
        {stat("Total wt", `${f.totalWeight.toFixed(1)}%`)}
        {f.flow ? stat(`Net flow ${f.flow.periodDays}d`, `${f.flow.flowPct > 0 ? "+" : ""}${f.flow.flowPct.toFixed(1)}%`, f.flow.flowPct >= 0 ? c.buy : c.sell) : null}
      </View>
      {f.flow ? <Hint>Net creation/redemption: {f.flow.sharesDelta > 0 ? "+" : ""}{formatCount(f.flow.sharesDelta)} shares of {formatCount(f.flow.sharesOutstanding)} outstanding over {f.flow.periodDays} days.</Hint> : null}

      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.md }}>
        <FollowButton symbol={symbol} following={isFollowing("fund", symbol)} onToggle={() => toggleFollow("fund", symbol)} />
        {income ? <Action onPress={() => router.push(`/income/${encodeURIComponent(f.fund)}`)}>Income structure →</Action> : null}
      </View>

      {catchUp.active ? <Banner title={catchUp.since ? `Catch-up since ${formatShortDate(catchUp.since)}` : "Catch-up"} body="Changes over that gap aren't shown as one day: this fund's previous file was carried forward, so the latest diff spans several days." /> : null}
      {f.stale ? <Banner title={`Older disclosure · ${formatShortDate(f.holdingsDate)}`} body={`The ${formatShortDate(f.asOfDate)} snapshot carries this book forward. These positions are not fresh trade signals. Quiet data is not proof of no trades.`} /> : null}
      {partial && activeTab === "positions" ? (
        <Note>{f.topHoldings.length > 0 ? `Showing the top ${f.topHoldings.length} stocks and every option leg. The full book (all stocks, cash and Treasuries)` : "Showing every option leg. The full book (stocks, cash and Treasuries)"} appears once the server update is live.</Note>
      ) : null}

      {tabs.length > 1 ? <Segmented options={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))} value={activeTab} onChange={setTab} /> : null}
      {activeTab === "changes" ? <Segmented options={(["daily", "weekly", "monthly"] as const).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} value={period} onChange={setPeriod} /> : null}

      {income && (activeTab === "positions" || activeTab === "activity") ? incomeNotices(inc).map((n) => <NoticeCard key={n.key} n={n} />) : null}

      {activeTab === "positions" ? (
        <>
          {incomeBook ? <IncomeSummary summary={inc!.positionsSummary!} legCount={liveLegCount(inc!.positions!)} topSector={topSector(posRows)} shortBook={inc!.archetype === "short-equity"} incomeLegVisible={inc!.incomeLegVisible} archetype={{ label: inc!.archetypeLabel, summary: inc!.archetypeSummary }} /> : null}
          <AllocationBar book={book} onPress={jumpTo} />
          {book.expiredHidden > 0 ? <Hint>{book.expiredHidden} expired option {book.expiredHidden === 1 ? "leg is" : "legs are"} hidden from the contract list.</Hint> : null}
          {incomeBook ? (
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={styles.search}>
                  <Ionicons name="search" size={16} color={c.textMuted} />
                  <TextInput value={filters.q} onChangeText={(v) => setFilters({ ...filters, q: v })} placeholder="Search symbol or name" placeholderTextColor={c.textMuted} autoCapitalize="characters" autoCorrect={false} style={styles.input} />
                </View>
                <Pressable onPress={() => setSheet(true)} accessibilityRole="button" style={[styles.filterBtn, (nFilters > 0 || posSort !== "value") && { borderColor: c.accent }]}>
                  <Ionicons name="options-outline" size={18} color={nFilters > 0 ? c.accent : c.textSecondary} />
                  <Text style={[styles.filterText, nFilters > 0 && { color: c.accent }]}>Filters{nFilters > 0 ? ` (${nFilters})` : ""}</Text>
                </Pressable>
              </View>
              {hasOptions ? <Segmented options={[{ value: "stock", label: "By stock" }, { value: "expiry", label: "By expiry" }, { value: "contracts", label: "Contracts" }]} value={group} onChange={setGroup} /> : null}
              <Hint>{SORT_LABEL[posSort]} {(posDir === "default" ? DEFAULT_DIR[posSort] : posDir) === "asc" ? "↑" : "↓"}{filtersActive(filters) ? " · filtered" : ""}</Hint>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );

  return (
    <SnapshotDate.Provider value={inc?.asOfDate ?? f.asOfDate ?? null}>
    <FundHasOptions.Provider value={hasOptions}>
      <SectionList<Item, Section>
        ref={listRef}
        style={styles.root}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl, ...columnStyle(winWidth, "table") }}
        sections={sections}
        keyExtractor={(item, i) => itemKey(item, i)}
        ListHeaderComponent={header}
        stickySectionHeadersEnabled={false}
        initialNumToRender={20}
        windowSize={7}
        onScrollToIndexFailed={() => {}}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); bookQ.refetch(); if (income) incomeQ.refetch(); }} tintColor={c.accent} />}
        renderSectionHeader={({ section }) => section.title ? (
          <View style={styles.sectionHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.subtitle ? <Hint>{section.subtitle}</Hint> : null}
            </View>
            {section.sort === "stocks" ? <SortChips value={stockSort} onChange={setStockSort} options={STOCK_SORTS} /> : section.sort === "options" ? <SortChips value={optionSort} onChange={setOptionSort} options={OPTION_SORTS} /> : null}
          </View>
        ) : null}
        renderItem={({ item }) => renderItem(item, { opened, toggledPos, defaultOpen: posRows.length <= 5, togglePos: (k) => toggleIn(toggledPos, k, setToggledPos), toggleBucket: (k) => toggleIn(openBuckets, k, setOpenBuckets) })}
        ListEmptyComponent={bookQ.isLoading ? <Loading /> : <Card><Note>No positions reported for this fund.</Note></Card>}
      />
      <FilterSheet visible={sheet} title="Filters & sort" onClose={() => setSheet(false)} onReset={() => { setFilters(NO_FILTERS); setPosSort("value"); setPosDir("default"); }} applyLabel={`Show ${filtered.length} positions`}>
        {hasOptions ? <OptionGroup<Coverage> label="Coverage" value={filters.cov} onChange={(cov) => setFilters({ ...filters, cov })} options={(Object.keys(COVERAGE_LABEL) as Coverage[]).map((k) => ({ value: k, label: COVERAGE_LABEL[k] }))} /> : null}
        <ToggleGroup toggles={filters.toggles} hasOptions={hasOptions} onChange={(toggles) => setFilters({ ...filters, toggles })} />
        <OptionGroup label="Sector" value={filters.sector} onChange={(sector) => setFilters({ ...filters, sector })} options={[{ value: "", label: "All sectors" }, ...sectorsOf(posRows).map((s) => ({ value: s, label: s }))]} />
        <OptionGroup<PosSort> label="Sort by" value={posSort} onChange={setPosSort} options={(Object.keys(SORT_LABEL) as PosSort[]).filter((k) => hasOptions || !OPTION_SORTS_KEYS.includes(k)).map((k) => ({ value: k, label: SORT_LABEL[k] }))} />
        <OptionGroup<"default" | "asc" | "desc"> label="Direction" value={posDir} onChange={setPosDir} options={[{ value: "default", label: "Default for this column" }, { value: "asc", label: "Ascending ↑" }, { value: "desc", label: "Descending ↓" }]} />
      </FilterSheet>
    </FundHasOptions.Provider>
    </SnapshotDate.Provider>
  );
}

function ToggleGroup({ toggles, onChange, hasOptions }: { toggles: Set<Toggle>; onChange: (t: Set<Toggle>) => void; hasOptions: boolean }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={styles.groupLabel}>SHOW ONLY</Text>
      {(Object.keys(TOGGLE_LABEL) as Toggle[]).filter((k) => hasOptions || k === "changed").map((k) => {
        const on = toggles.has(k);
        return (
          <Pressable key={k} onPress={() => { const n = new Set(toggles); on ? n.delete(k) : n.add(k); onChange(n); }} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={styles.toggle}>
            <Ionicons name={on ? "checkbox" : "square-outline"} size={20} color={on ? c.accent : c.textMuted} />
            <Text style={[styles.toggleText, on && { color: c.textPrimary }]}>{TOGGLE_LABEL[k]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function renderItem(item: Item, ctx: { opened: Map<string, string>; toggledPos: Set<string>; defaultOpen: boolean; togglePos: (k: string) => void; toggleBucket: (k: string) => void }): ReactElement | null {
  switch (item.t) {
    case "stock": return <StockRow line={item.line} />;
    case "more": return <MoreRow total={item.total} open={item.open} onPress={item.onPress} noun={item.noun} />;
    case "ogroup": return <OptionGroupHeader group={item.group} />;
    case "oleg": return <OptionRow line={item.line} />;
    case "activity": return <ActivityBox lines={item.lines} />;
    case "bucket": return <BucketRow bucket={item.bucket} open={item.open} onPress={() => ctx.toggleBucket(item.bucket.sleeve)} />;
    case "bline": return <BucketLineRow name={item.name} valueText={item.valueText} weight={item.weight} />;
    case "pos": return <PositionCard r={item.row} opened={ctx.opened} open={ctx.defaultOpen !== ctx.toggledPos.has(item.row.p.ticker)} onToggle={() => ctx.togglePos(item.row.p.ticker)} />;
    case "posleg": return <LegRow leg={item.leg} ticker={item.ticker} opened={ctx.opened.get(optionKeyOf(item.ticker, item.leg))} />;
    case "exp": return item.expiry ? <ExpiryHeader expiry={item.expiry} dte={item.dte} count={item.count} /> : null;
    case "other": return <OtherPositionRow o={item.o} />;
    case "day": return <DayHeader d={item.d} />;
    case "trade": return <TradeRow t={item.trade} />;
    case "change": return <ChangeRow ch={item.ch} />;
    case "optchange": return <OptionChangeRow ch={item.ch} />;
    case "streak": return <StreakRow s={item.s} />;
    case "roll": return <RollCard roll={item.roll} />;
    case "node": return <>{item.node}</>;
  }
}

const itemKey = (item: Item, i: number): string => {
  switch (item.t) {
    case "stock": return item.line.key;
    case "oleg": return item.line.key;
    case "ogroup": return `g:${item.group.underlying}`;
    case "bucket": return `bk:${item.bucket.sleeve}`;
    case "pos": return `p:${item.row.p.ticker}`;
    case "posleg": return `pl:${item.ticker}:${item.leg.expiry}:${item.leg.strike}:${item.leg.optionType}:${i}`;
    case "exp": return `x:${item.expiry}:${i}`;
    case "other": return `o:${item.o.sleeve}`;
    case "day": return `d:${item.d.date}`;
    case "trade": case "change": case "optchange": case "roll": case "node": case "more": return `${item.t}:${item.id}`;
    case "streak": return `st:${item.s.ticker}`;
    default: return `${item.t}:${i}`;
  }
};

const STOCK_SORTS: { value: SortKey; label: string }[] = [{ value: "value", label: "Value" }, { value: "weight", label: "%" }, { value: "change", label: "Change" }];
const OPTION_SORTS_KEYS: PosSort[] = ["coverage", "upside", "dte"];
const OPTION_SORTS: { value: SortKey; label: string }[] = [{ value: "expiry", label: "Expiry" }, { value: "value", label: "Value" }, { value: "weight", label: "%" }, { value: "change", label: "Change" }];

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.canvas },
    eyebrow: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4 },
    symbol: { ...display, color: c.textPrimary, fontSize: 48, lineHeight: 52, marginTop: spacing.xs },
    provider: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    total: { ...display, color: c.textPrimary, fontSize: 28, letterSpacing: -1 },
    stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    statBox: { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2, minWidth: 84 },
    statLabel: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 9.5, letterSpacing: 0.8 },
    sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.xs, backgroundColor: c.canvas },
    sectionTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18 },
    search: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TAP, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md },
    input: { flex: 1, color: c.textPrimary, fontFamily: fonts.body, fontSize: 14, paddingVertical: 0, minHeight: MIN_TAP },
    filterBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TAP, paddingHorizontal: spacing.md, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.pill },
    filterText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
    groupLabel: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 0.8 },
    toggle: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: MIN_TAP },
    toggleText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 15 },
  });
