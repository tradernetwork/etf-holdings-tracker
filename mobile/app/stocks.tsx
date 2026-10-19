import { useMemo, useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import {
  Action,
  ListPage,
  Search,
  Title,
  DenseRow,
  RowBadge,
} from "@/components/discovery-ui";
import { Hint, Mono, Badge, Tappable, Note, QueryStatus } from "@/components/ui";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import { useStocks } from "@/lib/discovery/api";
import { emptyStockFilters, filterStocks } from "@/lib/discovery/derive";
import type {
  StockFilters,
  StockSort,
  StockSignal,
} from "@/lib/discovery/types";
import { useFunds } from "@/lib/queries";
import {
  cleanName,
  formatPp,
  formatWeight,
  formatShortDate,
  pluralize,
} from "@/lib/format";
import { useTheme } from "@/lib/theme-context";
import { deltaColor } from "@/lib/theme";
const SORTS: { value: StockSort; label: string }[] = [
  { value: "funds", label: "Most widely held" },
  { value: "weight", label: "Most weight" },
  { value: "change", label: "Biggest Δ" },
  { value: "streak", label: "Longest streak" },
];
const SIGNALS: { value: StockSignal; label: string }[] = [
  { value: "all", label: "All signals" },
  { value: "buying", label: "Net buying" },
  { value: "selling", label: "Net selling" },
  { value: "streak", label: "3+ day streak" },
  { value: "new", label: "New entries" },
  { value: "exit", label: "Exits" },
  { value: "crossfam", label: "2+ families" },
];
export default function Stocks() {
  const c = useTheme(),
    [f, setF] = useState<StockFilters>(emptyStockFilters),
    [sheet, setSheet] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null);
  const q = useStocks(f.sort === "weight" ? "weight" : "funds"),
    funds = useFunds(),
    map = useMemo(
      () => new Map((funds.data?.funds ?? []).map((r) => [r.fund, r])),
      [funds.data],
    );
  const source = q.data?.tickers ?? [],
    rows = filterStocks(source, f, map);
  const patch = (v: Partial<StockFilters>) => setF((old) => ({ ...old, ...v }));
  return (
    <ListPage
      dense
      loaded={!!q.data}
      data={rows}
      keyFor={(r) => r.ticker}
      refreshing={q.isRefetching}
      onRefresh={() => {
        q.refetch();
        funds.refetch();
      }}
      header={
        <>
          <Title>Stocks</Title>
          {q.data && (
            <Hint>
              {formatShortDate(q.data.asOfDate)} · {rows.length} of{" "}
              {source.length} ranked underlyings
            </Hint>
          )}
          <Search
            value={f.search}
            onChange={(search) => patch({ search })}
            placeholder="Search ticker or company"
          />
          <Action onPress={() => setSheet(true)}>
            Filters & sort · {SORTS.find((s) => s.value === f.sort)?.label}
          </Action>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(["provider", "sector", "signal"] as const)
              .filter((k) => f[k] && f[k] !== "all")
              .map((k) => (
                <Action
                  key={k}
                  onPress={() => patch({ [k]: emptyStockFilters[k] })}
                >
                  {f[k]} ×
                </Action>
              ))}
          </View>
          <Note>
            Across all tracked fund categories, like the website stock
            directory. Total weight is a sum of fund allocations, not a
            portfolio weight.
          </Note>
          {q.data?.count === 1000 && (
            <Note>
              Top 1,000 by the selected API ranking; more underlyings may exist.
              Search filters this returned universe.
            </Note>
          )}
          <QueryStatus q={q} />
          {funds.isError && (
            <Note>
              Provider lookup unavailable. Retry Explore to restore provider
              filters.
            </Note>
          )}
        </>
      }
      renderItem={({ item: r, index }) => (
        <DenseRow
          label={`${r.ticker}, ${pluralize(r.fundCount, "fund")}, ${formatPp(r.netChange)}, ${formatWeight(r.totalWeight)} total weight, ${r.distinctProviders ?? "unknown"} families, ${r.newEntryFunds.length} new fund entries, ${r.exitFunds?.length ?? 0} exits, ${r.streak ?? "unknown"} day streak. ${expanded === r.ticker ? "Collapse" : "Expand"} stock details`}
          expanded={expanded === r.ticker}
          onPress={() => setExpanded(expanded === r.ticker ? null : r.ticker)}
          top={
            <>
              <Mono bold style={{ fontSize: 14 }}>
                {index + 1}. {r.ticker}
              </Mono>
              {!!r.newEntryFunds?.length && (
                <RowBadge
                  label={`NEW ${r.newEntryFunds.length}`}
                  color={c.isNew}
                />
              )}
              {!!r.exitFunds?.length && (
                <RowBadge label={`EXIT ${r.exitFunds.length}`} color={c.sell} />
              )}
              {Math.abs(r.streak ?? 0) >= 2 && (
                <RowBadge
                  label={`${Math.abs(r.streak!)}d`}
                  color={r.streak! > 0 ? c.buy : c.sell}
                />
              )}
              {(r.distinctProviders ?? 0) >= 2 && (
                <RowBadge label={`${r.distinctProviders}F`} color={c.accent} />
              )}
            </>
          }
          rightTop={
            <Mono style={{ fontSize: 13, color: deltaColor(r.netChange, c) }}>
              {formatPp(r.netChange)}
            </Mono>
          }
          bottom={
            <Hint>
              {pluralize(r.fundCount, "fund")} · {formatWeight(r.totalWeight)} total weight
            </Hint>
          }
          rightBottom={<Hint>Details {expanded === r.ticker ? "−" : "+"}</Hint>}
        >
          <Tappable
            onPress={() =>
              router.push(`/ticker/${encodeURIComponent(r.ticker)}`)
            }
          >
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Mono bold>
                {index + 1}. {r.ticker} →
              </Mono>
              <Mono style={{ color: deltaColor(r.netChange, c) }}>
                {formatPp(r.netChange)}
              </Mono>
            </View>
            <Hint>
              {cleanName(r.name)} · {r.sector || "Sector not reported"}
            </Hint>
            <Hint>
              {pluralize(r.fundCount, "fund")} · {formatWeight(r.totalWeight)} total weight ·{" "}
              {r.distinctProviders == null ? "—" : pluralize(r.distinctProviders, "family", "families")}
            </Hint>
          </Tappable>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {r.newEntryFunds?.length > 0 && (
              <Badge
                label={`NEW · ${r.newEntryFunds.join(", ")}`}
                color={c.isNew}
              />
            )}{" "}
            {!!r.exitFunds?.length && (
              <Badge
                label={`EXIT · ${r.exitFunds.join(", ")}`}
                color={c.sell}
              />
            )}{" "}
            {r.streak != null && Math.abs(r.streak) >= 2 && (
              <Badge
                label={`${Math.abs(r.streak)}d ${r.streak > 0 ? "buy" : "sell"} streak`}
                color={r.streak > 0 ? c.buy : c.sell}
              />
            )}{" "}
            {(r.distinctProviders ?? 0) >= 2 && (
              <Badge label="CROSS FAMILY" color={c.accent} />
            )}
          </View>
          <Action
            onPress={() => setExpanded(expanded === r.ticker ? null : r.ticker)}
          >
            {expanded === r.ticker
              ? "Hide holders"
              : `View all ${r.funds.length} fund links`}
          </Action>
          {expanded === r.ticker && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {r.funds.map((fund) => (
                <Action
                  key={fund}
                  onPress={() =>
                    router.push(`/fund/${encodeURIComponent(fund)}`)
                  }
                >
                  {fund}
                </Action>
              ))}
            </View>
          )}
        </DenseRow>
      )}
    >
      <FilterSheet
        visible={sheet}
        title="Stock filters"
        onClose={() => setSheet(false)}
        onReset={() => setF(emptyStockFilters)}
        applyLabel={`Show ${pluralize(rows.length, "stock")}`}
      >
        <OptionGroup
          label="Sort"
          value={f.sort}
          onChange={(sort) => patch({ sort })}
          options={SORTS}
        />
        <OptionGroup
          label="Signal"
          value={f.signal}
          onChange={(signal) => patch({ signal })}
          options={SIGNALS.map((option) => ({
            ...option,
            hint: String(
              filterStocks(source, { ...f, signal: option.value }, map).length,
            ),
          }))}
        />
        <OptionGroup
          label="Provider"
          value={f.provider}
          onChange={(provider) => patch({ provider })}
          options={[
            { value: "", label: "All providers" },
            ...[...new Set([...map.values()].map((r) => r.provider))]
              .sort()
              .map((value) => ({
                value,
                label: value,
                hint: String(
                  filterStocks(source, { ...f, provider: value }, map).length,
                ),
              })),
          ]}
        />
        <OptionGroup
          label="Sector"
          value={f.sector}
          onChange={(sector) => patch({ sector })}
          options={[
            { value: "", label: "All sectors" },
            ...[...new Set(source.map((r) => r.sector).filter(Boolean))]
              .sort()
              .map((value) => ({
                value,
                label: value,
                hint: String(
                  filterStocks(source, { ...f, sector: value }, map).length,
                ),
              })),
          ]}
        />
      </FilterSheet>
    </ListPage>
  );
}
