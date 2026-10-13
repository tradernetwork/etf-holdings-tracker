import { useAppState } from "@/lib/app-state";
import {
  CATEGORY_OPTIONS,
  scopeChanges,
  scopeLabel,
} from "@/lib/discovery/scope";
import { changeSections } from "@/lib/discovery/sections";
import { deltaColor } from "@/lib/theme";
import { useState, useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import {
  Action,
  ChangeCard,
  SectionPage,
  DenseRow,
  Search,
  Title,
} from "@/components/discovery-ui";
import {
  Mono,
  ErrorNote,
  Hint,
  Loading,
  Note,
  Segmented,
} from "@/components/ui";
import { useChanges } from "@/lib/discovery/api";
import { deltaLabel } from "@/lib/deltaPeriod";
import {
  emptyChangeFilters,
  filterChanges,
  moveCounts,
} from "@/lib/discovery/derive";
import type { ChangeFilters, Period } from "@/lib/discovery/types";
import { useFunds } from "@/lib/queries";
import { useTheme } from "@/lib/theme-context";
import { formatPp, formatUsd, formatShortDate } from "@/lib/format";
export default function Changes() {
  const c = useTheme(),
    params = useLocalSearchParams<{ search?: string; fund?: string }>();
  const { category, setCategory } = useAppState();
  const [period, setPeriod] = useState<Period>("daily"),
    [f, setF] = useState<ChangeFilters>({
      ...emptyChangeFilters,
      search: String(params.search ?? ""),
      fund: String(params.fund ?? ""),
    }),
    [sheet, setSheet] = useState(false),
    [grouped, setGrouped] = useState(true),
    [byTicker, setByTicker] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null);
  const q = useChanges(period),
    funds = useFunds();
  const map = useMemo(
    () => new Map((funds.data?.funds ?? []).map((r) => [r.fund, r])),
    [funds.data],
  );
  const source = useMemo(
    () => scopeChanges(q.data?.changes ?? [], category, map),
    [q.data, category, map],
  );
  const filtered = useMemo(
    () => filterChanges(source, f, map),
    [source, f, map],
  );
  const rows = filtered;
  const sections = useMemo(
    () => changeSections(rows, map, grouped, byTicker, expanded),
    [rows, map, grouped, byTicker, expanded],
  );
  const counts = moveCounts(filtered);
  const values = (key: "sector" | "fund") =>
    [...new Set(source.map((r) => r[key]).filter(Boolean))].sort();
  const providers = [
    ...new Set([...map.values()].map((r) => r.provider)),
  ].sort();
  const patch = (v: Partial<ChangeFilters>) =>
    setF((old) => ({ ...old, ...v }));
  const header = (
    <>
      <Title>Changes</Title>
      <Hint>
        {formatShortDate(q.data?.asOfDate)} · {source.length} stock-position
        changes across{" "}
        {scopeLabel(category, new Set(source.map((r) => r.fund)).size)} ·{" "}
        {rows.length} shown · {counts.added} added / {counts.reduced} reduced
      </Hint>
      {deltaLabel("Δ weight and shares", q.data ?? {}) ? <Hint>{deltaLabel("Δ weight and shares", q.data ?? {})}</Hint> : null}
      <Segmented
        options={CATEGORY_OPTIONS}
        value={category}
        onChange={setCategory}
      />
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: "daily", label: "Day" },
          { value: "weekly", label: "7 days" },
          { value: "monthly", label: "30 days" },
        ]}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action onPress={() => setSheet(true)}>Filters</Action>
        <Action onPress={() => setGrouped(!grouped)}>
          {grouped ? "By provider" : "Ungrouped"}
        </Action>
        <Action onPress={() => setByTicker(!byTicker)}>
          {byTicker ? "Fund rows" : "By ticker"}
        </Action>
        <Action onPress={() => router.push(`/activity?period=${period}`)}>
          Activity matrix →
        </Action>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {Object.entries(f)
          .filter(
            ([k, v]) => v && v !== "all" && !["sort", "ascending"].includes(k),
          )
          .map(([k, v]) => (
            <Action
              key={k}
              onPress={() =>
                patch({ [k]: emptyChangeFilters[k as keyof ChangeFilters] })
              }
            >
              {v} ×
            </Action>
          ))}
      </View>
      <Note>
        Active Δ is drift adjusted; dollar flow is estimated. Tap a row for
        sector, full name and fund links. Catch-up deltas are withheld.
        {category !== "active-equity" &&
          " Option-income stock moves are collateral mechanics, not stock conviction."}
      </Note>
      {f.fund &&
        category !== "all" &&
        map.get(f.fund)?.category &&
        map.get(f.fund)?.category !== category && (
          <Note>
            {f.fund} belongs to {map.get(f.fund)?.category}. Switch category or
            choose All to see its changes.
          </Note>
        )}
      {q.data?.truncated && (
        <Note>
          A fund still reaches the API limit after provider/fund splitting.
          Further changes may be omitted.
        </Note>
      )}
      {q.isLoading && <Loading />}
      {q.isError && (
        <ErrorNote
          message="Couldn't load changes."
          onRetry={() => q.refetch()}
        />
      )}{" "}
      {funds.isError && (
        <Note>
          Provider and AUM lookup unavailable; fund symbols and reported dollar
          estimates remain visible.
        </Note>
      )}
    </>
  );
  return (
    <SectionPage
      sections={sections}
      showHeaders={grouped || byTicker}
      header={header}
      refreshing={q.isRefetching}
      onRefresh={() => {
        q.refetch();
        funds.refetch();
      }}
      renderItem={({ item }) => {
        const a = item.aggregate;
        if (a)
          return (
            <DenseRow
              label={`${a.ticker}, ${a.rows.length} fund changes. ${expanded === a.ticker ? "Collapse" : "Expand"} all evidence`}
              expanded={expanded === a.ticker}
              onPress={() =>
                setExpanded(expanded === a.ticker ? null : a.ticker)
              }
              top={
                <Mono bold style={{ fontSize: 14 }}>
                  {a.ticker}
                </Mono>
              }
              rightTop={
                <Mono
                  style={{ fontSize: 13, color: deltaColor(a.netDelta, c) }}
                >
                  {formatPp(a.netDelta)} net
                </Mono>
              }
              bottom={
                <Hint>
                  {a.buying.length} buying · {a.selling.length} selling ·{" "}
                  {a.rows.length} fund rows
                </Hint>
              }
              rightBottom={<Hint>est. {formatUsd(a.flowUsd)}</Hint>}
            >
              <Hint>
                {a.rows[0].name} · {a.rows[0].sector || "Sector not reported"}
              </Hint>
              <Hint>
                {a.knownDollarRows} of {a.rows.length} rows have known dollar
                flow. Unknown rows excluded from sums.
              </Hint>
              <Action
                onPress={() =>
                  router.push(`/ticker/${encodeURIComponent(a.ticker)}`)
                }
              >
                Open {a.ticker} →
              </Action>
              <Hint>All {a.rows.length} fund changes below</Hint>
            </DenseRow>
          );
        return <ChangeCard row={item.row!} fund={map.get(item.row!.fund)} />;
      }}
    >
      <FilterSheet
        visible={sheet}
        title="Change filters"
        onClose={() => setSheet(false)}
        onReset={() => setF(emptyChangeFilters)}
        applyLabel={`Show ${rows.length} changes`}
      >
        <Search value={f.search} onChange={(search) => patch({ search })} />
        <OptionGroup
          label="Fund"
          value={f.fund}
          onChange={(fund) => patch({ fund })}
          options={[
            { value: "", label: "All funds" },
            ...values("fund").map((value) => ({ value, label: value })),
          ]}
        />
        <OptionGroup
          label="Provider"
          value={f.provider}
          onChange={(provider) => patch({ provider })}
          options={[
            { value: "", label: "All providers" },
            ...providers.map((value) => ({ value, label: value })),
          ]}
        />
        <OptionGroup
          label="Sector"
          value={f.sector}
          onChange={(sector) => patch({ sector })}
          options={[
            { value: "", label: "All sectors" },
            ...values("sector").map((value) => ({ value, label: value })),
          ]}
        />
        <OptionGroup
          label="Type"
          value={f.type}
          onChange={(type) => patch({ type })}
          options={(["all", "NEW", "EXIT", "ADD", "TRIM"] as const).map(
            (value) => ({
              value,
              label: value === "all" ? "All types" : value,
            }),
          )}
        />
        <OptionGroup
          label="Sort column"
          value={f.sort ?? "delta"}
          onChange={(sort) => patch({ sort, ascending: sort !== "delta" })}
          options={[
            { value: "delta", label: "Active Δ magnitude" },
            { value: "ticker", label: "Ticker" },
            { value: "name", label: "Name" },
            { value: "fund", label: "Fund" },
            { value: "type", label: "Type" },
          ]}
        />
        <OptionGroup
          label="Sort order"
          value={f.ascending ? "asc" : "desc"}
          onChange={(value) => patch({ ascending: value === "asc" })}
          options={[
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ]}
        />
        <OptionGroup
          label="Direction"
          value={f.direction}
          onChange={(direction) => patch({ direction })}
          options={[
            { value: "all", label: "Both directions" },
            { value: "buying", label: "Buying" },
            { value: "selling", label: "Selling" },
          ]}
        />
      </FilterSheet>
    </SectionPage>
  );
}
