import { useState, useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View, Text } from "react-native";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import {
  Action,
  ChangeCard,
  ListPage,
  Search,
  Title,
} from "@/components/discovery-ui";
import {
  Card,
  Mono,
  ErrorNote,
  Hint,
  Loading,
  Note,
  Segmented,
} from "@/components/ui";
import { useChanges } from "@/lib/discovery/api";
import {
  aggregateChanges,
  emptyChangeFilters,
  filterChanges,
  moveCounts,
} from "@/lib/discovery/derive";
import type { ChangeFilters, Period } from "@/lib/discovery/types";
import { useFunds } from "@/lib/queries";
import { useTheme } from "@/lib/theme-context";
import type { Change } from "@/lib/types";
import { formatPp, formatUsd, formatShortDate } from "@/lib/format";
export default function Changes() {
  const c = useTheme(),
    params = useLocalSearchParams<{ search?: string; fund?: string }>();
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
  const source = q.data?.changes ?? [];
  const filtered = useMemo(
    () => filterChanges(source, f, map),
    [source, f, map],
  );
  const rows = grouped
    ? [...filtered].sort((a, b) =>
        (map.get(a.fund)?.provider ?? a.fund).localeCompare(
          map.get(b.fund)?.provider ?? b.fund,
        ),
      )
    : filtered;
  const aggregates = aggregateChanges(filtered, map);
  const data: {
    id: string;
    row?: Change;
    aggregate?: (typeof aggregates)[number];
  }[] = byTicker
    ? aggregates.map((aggregate) => ({ id: aggregate.ticker, aggregate }))
    : rows.map((row) => ({ id: `${row.fund}:${row.ticker}:${row.type}`, row }));
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
        {formatShortDate(q.data?.asOfDate)} · {rows.length} of {source.length}{" "}
        equity changes · {counts.added} added / {counts.reduced} reduced
      </Hint>
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
        Complete equity change feed, including smaller adjustments. Daily
        catch-up changes are withheld by the API. Periods compare disclosed
        snapshots, not intraday trades.
      </Note>
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
    <ListPage
      data={data}
      header={header}
      keyFor={(r) => r.id}
      refreshing={q.isRefetching}
      onRefresh={() => {
        q.refetch();
        funds.refetch();
      }}
      renderItem={({ item, index }) => {
        const a = item.aggregate;
        if (a)
          return (
            <Card>
              <Mono bold>{a.ticker}</Mono>
              <Hint>
                {a.rows[0].name} · {a.rows[0].sector || "Sector not reported"}
              </Hint>
              <Hint>
                {a.buying.length} buying: {a.buying.join(", ") || "none"} ·{" "}
                {a.selling.length} selling: {a.selling.join(", ") || "none"}
              </Hint>
              <Mono>
                {formatPp(a.netDelta)} net · est. {formatUsd(a.flowUsd)} flow
              </Mono>
              <Hint>
                {a.knownDollarRows} of {a.rows.length} rows with known dollar
                flow; unknown rows excluded from sums.
              </Hint>
              <Action
                onPress={() =>
                  setExpanded(expanded === a.ticker ? null : a.ticker)
                }
              >
                {expanded === a.ticker
                  ? "Hide fund evidence"
                  : `View all ${a.rows.length} fund changes`}
              </Action>
              {expanded === a.ticker &&
                a.rows.map((r) => (
                  <ChangeCard
                    key={`${r.fund}:${r.type}`}
                    row={r}
                    fund={map.get(r.fund)}
                  />
                ))}
            </Card>
          );
        const r = item.row!;
        return (
          <View style={{ gap: 8 }}>
            {grouped &&
              (index === 0 ||
                (map.get(rows[index - 1].fund)?.provider ??
                  rows[index - 1].fund) !==
                  (map.get(r.fund)?.provider ?? r.fund)) && (
                <Text style={{ color: c.textSecondary, fontWeight: "bold" }}>
                  {map.get(r.fund)?.provider ?? r.fund}
                </Text>
              )}
            <ChangeCard row={r} fund={map.get(r.fund)} />
          </View>
        );
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
    </ListPage>
  );
}
