import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import { Card, ErrorNote, FreshnessLabel, Loading, Mono, Note, Screen, SectionHeader, Tappable } from "@/components/ui";
import { formatUsd, freshnessLabel, fundAumUsd } from "@/lib/format";
import { useFunds } from "@/lib/queries";
import { colors, fonts, MIN_TAP, radii, spacing } from "@/lib/theme";
import type { FundSummary } from "@/lib/types";

type CategoryFilter = "all" | "active-equity" | "option-income";
const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All funds" },
  { value: "active-equity", label: "Active Equity" },
  { value: "option-income", label: "Option-Income" },
];
const TICKER_SHAPE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

export default function Explore() {
  const funds = useFunds();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [provider, setProvider] = useState("all");
  const [sheet, setSheet] = useState(false);

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
      .map(([name, list]) => ({ name, list: list.sort((a, b) => (b.aum ?? 0) - (a.aum ?? 0)) }))
      .sort((a, b) => (b.list[0].aum ?? 0) - (a.list[0].aum ?? 0));
  }, [visible]);

  const activeFilters = (category !== "all" ? 1 : 0) + (provider !== "all" ? 1 : 0);
  const reset = () => { setCategory("all"); setProvider("all"); };
  const tickerQuery = TICKER_SHAPE.test(query.trim()) ? query.trim().toUpperCase() : null;

  return (
    <Screen refreshing={funds.isRefetching} onRefresh={() => funds.refetch()}>
      <Text style={styles.title}>Explore</Text>

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ticker or fund"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => tickerQuery && router.push(`/ticker/${encodeURIComponent(tickerQuery)}`)}
            style={styles.input}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} accessibilityLabel="Clear search" hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable onPress={() => setSheet(true)} accessibilityRole="button" style={[styles.filterBtn, activeFilters > 0 && { borderColor: colors.accent }]}>
          <Ionicons name="options-outline" size={18} color={activeFilters > 0 ? colors.accent : colors.textSecondary} />
          <Text style={[styles.filterText, activeFilters > 0 && { color: colors.accent }]}>
            Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </Text>
        </Pressable>
      </View>

      {tickerQuery && (
        <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(tickerQuery)}`)}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Ionicons name="trending-up" size={20} color={colors.accent} />
            <Text style={{ color: colors.textPrimary, fontFamily: fonts.bodyMedium, fontSize: 15, flex: 1 }}>
              Look up ticker <Mono bold>{tickerQuery}</Mono>
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Card>
        </Tappable>
      )}

      {funds.isLoading && <Loading />}
      {funds.isError && <ErrorNote message="Couldn't load the fund list." onRetry={() => funds.refetch()} />}

      {funds.data && (
        <>
          <SectionHeader title="Funds" right={<Text style={styles.hint}>{visible.length} of {all.length}</Text>} />
          {groups.length === 0 && <Card><Note>No funds match. Try clearing the search or filters.</Note></Card>}
          {groups.map((g) => (
            <View key={g.name} style={{ gap: spacing.xs }}>
              <Text style={styles.provider}>{g.name.toUpperCase()}</Text>
              <Card style={{ paddingVertical: spacing.xs, gap: 0 }}>
                {g.list.map((f) => (
                  <Tappable key={f.fund} onPress={() => router.push(`/fund/${encodeURIComponent(f.fund)}`)} style={styles.fundRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Mono bold style={{ fontSize: 16 }}>{f.fund}</Mono>
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

      <FilterSheet visible={sheet} title="Filters" onClose={() => setSheet(false)} onReset={reset} applyLabel={`Show ${visible.length} funds`}>
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

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontFamily: fonts.bodyBold, fontSize: 24 },
  searchRow: { flexDirection: "row", gap: spacing.sm },
  search: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TAP,
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md,
  },
  input: { flex: 1, color: colors.textPrimary, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0, minHeight: MIN_TAP },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TAP, paddingHorizontal: spacing.md,
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radii.pill,
  },
  filterText: { color: colors.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 },
  provider: { color: colors.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginTop: spacing.sm },
  fundRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
});
