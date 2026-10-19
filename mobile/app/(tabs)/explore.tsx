import { Action } from "@/components/discovery-ui";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import { OptionsTeaser } from "@/components/options/OptionsTeaser";
import { Card, FreshnessLabel, Mono, Note, Screen, SectionHeader, Tappable, QueryStatus } from "@/components/ui";
import { formatPp, formatUsd, pluralize, freshnessLabel, fundAumUsd } from "@/lib/format";
import { buildFundActivity, buildTopMovers, directoryHeadline, FUND_SORTS, rankExactFundFirst, resolveSearch, sortFunds, type DirectoryFund, type FundSort } from "@/lib/fundDirectory";
import { useChanges } from "@/lib/discovery/api";
import { useFunds } from "@/lib/queries";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { FundSummary } from "@/lib/types";

type CategoryFilter = "all" | "active-equity" | "option-income";
const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All funds" },
  { value: "active-equity", label: "Active Equity" },
  { value: "option-income", label: "Option-Income" },
];
const EXPLORE_LINKS = [
  { label: "Changes", href: "/changes" },
  { label: "Stocks", href: "/stocks" },
  { label: "Holdings", href: "/holdings" },
  { label: "Institutional trend", href: "/trend" },
  { label: "Effectiveness", href: "/effectiveness" },
  { label: "Consensus", href: "/layering" },
  { label: "Income funds", href: "/income" },
] as const;

export default function Explore() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const funds = useFunds();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [provider, setProvider] = useState("all");
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<FundSort>("aum");
  const daily = useChanges("daily");
  const movers = useMemo(() => buildTopMovers(daily.data?.changes ?? []), [daily.data]);
  const activity = useMemo(() => buildFundActivity(daily.data?.changes ?? []), [daily.data]);

  const all = funds.data?.funds ?? [];
  const providers = useMemo(() => [...new Set(all.map((f) => f.provider))].sort(), [all]);
  const q = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      all.filter(
        (f) =>
          (category === "all" || f.category === category) &&
          (provider === "all" || f.provider === provider) &&
          (!q || f.fund.toLowerCase().includes(q) || f.provider.toLowerCase().includes(q)),
      ),
    [all, category, provider, q],
  );

  const groups = useMemo(() => {
    const m = new Map<string, FundSummary[]>();
    for (const f of visible) m.set(f.provider, [...(m.get(f.provider) ?? []), f]);
    return [...m.entries()]
      .map(([name, list]) => ({ name, list: sortFunds(list as DirectoryFund[], sort) as (FundSummary & DirectoryFund)[] }))
      .sort((a, b) => Number(b.list.some((f) => f.fund.toUpperCase() === q.toUpperCase())) - Number(a.list.some((f) => f.fund.toUpperCase() === q.toUpperCase())) || (sort === "name" ? a.name.localeCompare(b.name) : (b.list.reduce((t, f) => t + (f.aum ?? 0), 0)) - (a.list.reduce((t, f) => t + (f.aum ?? 0), 0))));
  }, [visible, sort, q]);

  const activeFilters = (category !== "all" ? 1 : 0) + (provider !== "all" ? 1 : 0);
  const reset = () => { setCategory("all"); setProvider("all"); };
  const { fund: fundQuery, ticker: tickerQuery } = resolveSearch(query, all);
  const openTop = () => {
    if (fundQuery) router.push(`/fund/${encodeURIComponent(fundQuery)}`);
    else if (tickerQuery) router.push(`/ticker/${encodeURIComponent(tickerQuery)}`);
  };

  return (
    <Screen refreshing={funds.isRefetching} onRefresh={() => funds.refetch()}>
      <Text style={styles.title}>Explore</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {EXPLORE_LINKS.map((l) => (
          <View key={l.href} style={{ width: "48.5%", flexGrow: 1, flexBasis: "47%" }}>
            <Action fill onPress={() => router.push(l.href)}>{l.label} →</Action>
          </View>
        ))}
      </View>

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ticker or fund"
            placeholderTextColor={c.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={openTop}
            style={styles.input}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} accessibilityLabel="Clear search" hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable onPress={() => setSheet(true)} accessibilityRole="button" style={[styles.filterBtn, activeFilters > 0 && { borderColor: c.accent }]}>
          <Ionicons name="options-outline" size={18} color={activeFilters > 0 ? c.accent : c.textSecondary} />
          <Text style={[styles.filterText, activeFilters > 0 && { color: c.accent }]}>
            Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </Text>
        </Pressable>
      </View>

      {fundQuery && (
        <Tappable onPress={openTop}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Ionicons name="albums-outline" size={20} color={c.accent} />
            <Text style={{ color: c.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 15, flex: 1 }}>
              Open fund <Mono bold>{fundQuery}</Mono>
            </Text>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Card>
        </Tappable>
      )}

      {tickerQuery && (
        <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(tickerQuery)}`)}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Ionicons name="trending-up" size={20} color={c.accent} />
            <Text style={{ color: c.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 15, flex: 1 }}>
              Look up ticker <Mono bold>{tickerQuery}</Mono>
            </Text>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Card>
        </Tappable>
      )}

      <OptionsTeaser />

      <QueryStatus q={funds} />

      {funds.data && (
        <>
          <SectionHeader title="Funds" right={<Text style={styles.hint}>{visible.length} of {all.length}{funds.isFetching ? " · updating" : ""}</Text>} />
          <Text style={styles.hint}>{directoryHeadline(visible as DirectoryFund[])}</Text>
          <View style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
            <Text style={styles.sortLabel}>SORT</Text>
            {FUND_SORTS.map((o) => (
              <Pressable key={o.value} onPress={() => setSort(o.value)} accessibilityRole="button" accessibilityState={{ selected: sort === o.value }} style={[styles.sortChip, sort === o.value && { backgroundColor: c.border }]}>
                <Text style={[styles.sortText, sort === o.value && { color: c.textPrimary }]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          {daily.isLoading ? null : daily.isError ? <Text style={styles.hint}>Top moves unavailable right now.</Text> : null}
          {groups.length === 0 && <Card><Note>No funds match. Try clearing the search or filters.</Note></Card>}
          {groups.map((g) => (
            <View key={g.name} style={{ gap: spacing.xs }}>
              <Text style={styles.provider}>{g.name.toUpperCase()}</Text>
              <Card style={{ paddingVertical: spacing.xs, gap: 0 }}>
                {rankExactFundFirst(g.list, query).map((f) => (
                  <Tappable key={f.fund} onPress={() => router.push(`/fund/${encodeURIComponent(f.fund)}`)} style={styles.fundRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Mono bold style={{ fontSize: 16 }}>{f.fund}</Mono>
                      <Text style={styles.hint}>
                        {f.holdingsCount ?? "—"} holdings{f.optionsCount ? ` · +${f.optionsCount} options` : ""}
                        {f.topHolding ? ` · top ${f.topHolding.ticker} ${f.topHolding.weight.toFixed(1)}%` : ""}
                      </Text>
                      <MoveLine mover={movers.get(f.fund)} act={activity.get(f.fund)} />
                      <FreshnessLabel freshness={freshnessLabel({ stale: f.stale, date: f.lastHoldingsDate })} />
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Mono style={{ fontSize: 13 }}>{formatUsd(fundAumUsd(f))}</Mono>
                      <Text style={styles.hint}>{f.category === "active-equity" ? "Active" : "Income"}</Text>
                    </View>
                  </Tappable>
                ))}
              </Card>
            </View>
          ))}
        </>
      )}

      <FilterSheet visible={sheet} title="Filters" onClose={() => setSheet(false)} onReset={reset} applyLabel={`Show ${pluralize(visible.length, "fund")}`}>
        <OptionGroup label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        <OptionGroup
          label="Provider"
          options={[
            { value: "all", label: "All providers" },
            ...providers.map((p) => ({ value: p, label: p, hint: String(all.filter((f) => f.provider === p).length) })),
          ]}
          value={provider}
          onChange={setProvider}
        />
      </FilterSheet>
    </Screen>
  );
}

function MoveLine({ mover, act }: { mover?: { ticker: string; delta: number; type: string }; act?: { buys: number; sells: number } }) {
  const c = useTheme();
  if (!mover) return null;
  const up = mover.delta > 0;
  return (
    <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 11 }}>
      Top move <Text style={{ color: up ? c.buy : c.sell, fontFamily: fonts.monoBold }}>{up ? "▲" : "▼"} {mover.ticker} {formatPp(mover.delta)}</Text>
      {mover.type === "NEW" ? " NEW" : mover.type === "REMOVED" ? " EXIT" : ""}
      {act && (act.buys > 0 || act.sells > 0) ? ` · ${act.buys}↑ ${act.sells}↓` : ""}
    </Text>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  title: { color: c.textPrimary, ...display, fontSize: 30 },
  sortLabel: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginRight: 4 },
  sortChip: { minHeight: 32, paddingHorizontal: 10, justifyContent: "center", borderRadius: radii.pill },
  sortText: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 12 },
  searchRow: { flexDirection: "row", gap: spacing.sm },
  search: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TAP,
    backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md,
  },
  input: { flex: 1, color: c.textPrimary, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0, minHeight: MIN_TAP },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TAP, paddingHorizontal: spacing.md,
    backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.pill,
  },
  filterText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
  hint: { color: c.textMuted, fontFamily: fonts.body, fontSize: 11 },
  provider: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginTop: spacing.sm },
  fundRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  });
