import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import { ActivityRow } from "@/components/options/ActivityRow";
import { ShowMore } from "@/components/options/parts";
import { Card, ErrorNote, Hint, Loading, Note, Screen, Segmented } from "@/components/ui";
import { useFunds } from "@/lib/queries";
import {
  activeFilterCount, DEFAULT_ACTIVITY_FILTERS, filterActivity, groupByProvider, PERIOD_LABEL, signalLabel, sortActivity,
  type ActivityFilters,
} from "@/lib/options/logic";
import { useOptionActivity } from "@/lib/options/queries";
import type { ActivityPeriod } from "@/lib/options/types";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const GROUP_CAP = 6;
const PERIODS = (Object.keys(PERIOD_LABEL) as ActivityPeriod[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }));

/** Every option contract change in a window, grouped by provider (puts first), with filters. */
export default function OptionActivityScreen() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [period, setPeriod] = useState<ActivityPeriod>("daily");
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [sheet, setSheet] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const activity = useOptionActivity(period);
  const funds = useFunds();

  const providerOf = useMemo(() => {
    const m = new Map((funds.data?.funds ?? []).map((f) => [f.fund, f.provider]));
    return (fund: string) => m.get(fund) ?? "Other";
  }, [funds.data]);
  const categoryOf = useMemo(() => {
    const m = new Map((funds.data?.funds ?? []).map((f) => [f.fund, f.category]));
    return (fund: string) => m.get(fund);
  }, [funds.data]);

  const all = activity.data?.optionsActivity ?? [];
  const visible = useMemo(() => sortActivity(filterActivity(all, filters, categoryOf)), [all, filters, categoryOf]);
  const groups = useMemo(() => groupByProvider(visible, providerOf), [visible, providerOf]);
  const fundOptions = useMemo(() => [...new Set(all.map((r) => r.fund))].sort(), [all]);
  const counts = useMemo(() => {
    let opened = 0, rolled = 0, expired = 0, calls = 0, puts = 0;
    for (const r of visible) {
      const s = signalLabel(r.type);
      if (s === "OPENED") opened++; else if (s === "EXPIRED") expired++; else rolled++;
      if (r.optionDetails?.type.toLowerCase().startsWith("p")) puts++; else calls++;
    }
    return { opened, rolled, expired, calls, puts };
  }, [visible]);
  const nFilters = activeFilterCount(filters);
  const set = <K extends keyof ActivityFilters>(k: K) => (v: ActivityFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <Screen topInset={false} refreshing={activity.isRefetching} onRefresh={() => activity.refetch()}>
      <Text style={styles.title}>Option activity</Text>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput
            value={filters.q}
            onChangeText={set("q")}
            placeholder="Stock, fund or contract"
            placeholderTextColor={c.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
        <Pressable onPress={() => setSheet(true)} accessibilityRole="button" style={[styles.filterBtn, nFilters > 0 && { borderColor: c.accent }]}>
          <Ionicons name="options-outline" size={18} color={nFilters > 0 ? c.accent : c.textSecondary} />
          <Text style={[styles.filterText, nFilters > 0 && { color: c.accent }]}>Filters{nFilters > 0 ? ` (${nFilters})` : ""}</Text>
        </Pressable>
      </View>

      {(activity.isLoading || (activity.data && funds.isLoading)) && <Loading />}
      {activity.isError && <ErrorNote message="Couldn't load option activity." onRetry={() => activity.refetch()} />}
      {activity.data && !funds.isLoading && (
        <>
          <Hint>
            {visible.length} of {all.length} contracts · {counts.opened} opened · {counts.rolled} rolled · {counts.expired} expired · {counts.puts} puts · {counts.calls} calls
          </Hint>
          <Hint>Strategy and view are the site's reading of the fund's usual structure (puts as cash-secured, calls as covered), not a statement about each contract. Weight Δ is the contract's raw weight change.</Hint>
          {groups.length === 0 && <Card><Note>{all.length === 0 ? "No option contracts changed in this window." : "No contracts match. Clear the search or filters."}</Note></Card>}
          {groups.map((g) => {
            const isOpen = !!open[g.provider];
            const list = isOpen ? g.records : g.records.slice(0, GROUP_CAP);
            return (
              <View key={g.provider} style={{ gap: spacing.xs }}>
                <Text style={styles.provider}>{g.provider.toUpperCase()}  <Text style={{ fontFamily: fonts.mono }}>({g.records.length})</Text></Text>
                <Card style={{ paddingVertical: spacing.xs }}>
                  {list.map((r, i) => <ActivityRow key={`${r.fund}-${r.ticker}-${i}`} record={r} />)}
                  <ShowMore total={g.records.length} shown={GROUP_CAP} open={isOpen} onPress={() => setOpen((o) => ({ ...o, [g.provider]: !isOpen }))} />
                </Card>
              </View>
            );
          })}
        </>
      )}

      <FilterSheet visible={sheet} title="Filters" onClose={() => setSheet(false)} onReset={() => setFilters((f) => ({ ...DEFAULT_ACTIVITY_FILTERS, q: f.q }))} applyLabel={`Show ${visible.length} contracts`}>
        <OptionGroup label="Funds" options={[{ value: "all", label: "All funds" }, { value: "active-equity", label: "Active equity" }, { value: "option-income", label: "Option income" }]} value={filters.category} onChange={set("category")} />
        <OptionGroup label="Type" options={[{ value: "all", label: "Calls and puts" }, { value: "Call", label: "Calls" }, { value: "Put", label: "Puts" }]} value={filters.optionType} onChange={set("optionType")} />
        <OptionGroup label="Signal" options={[{ value: "all", label: "All" }, { value: "OPENED", label: "Opened" }, { value: "ROLLED", label: "Rolled / changed" }, { value: "EXPIRED", label: "Expired / closed" }]} value={filters.signal} onChange={set("signal")} />
        <OptionGroup label="Fund" options={[{ value: "all", label: "All funds" }, ...fundOptions.map((f) => ({ value: f, label: f }))]} value={filters.fund} onChange={set("fund")} />
      </FilterSheet>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { color: c.textPrimary, ...display, fontSize: 30 },
    searchRow: { flexDirection: "row", gap: spacing.sm },
    search: {
      flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TAP, backgroundColor: c.card,
      borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md,
    },
    input: { flex: 1, color: c.textPrimary, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0, minHeight: MIN_TAP },
    filterBtn: {
      flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TAP, paddingHorizontal: spacing.md,
      backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.pill,
    },
    filterText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
    provider: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginTop: spacing.sm },
  });
