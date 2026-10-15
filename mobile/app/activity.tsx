import { useState, useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View, Pressable, Text, Modal } from "react-native";
import { Screen, Hint, Note, Mono, Segmented, QueryStatus } from "@/components/ui";
import { Action, ChangeCard, Title } from "@/components/discovery-ui";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import { useActivity } from "@/lib/discovery/api";
import { matrixRows, moveLabel, moveType } from "@/lib/discovery/derive";
import { useFunds } from "@/lib/queries";
import type { Change } from "@/lib/types";
import type { Direction, Period } from "@/lib/discovery/types";
import { useTheme } from "@/lib/theme-context";
import { deltaColor } from "@/lib/theme";
import { formatPp, pluralize } from "@/lib/format";
export default function Activity() {
  const c = useTheme(),
    params = useLocalSearchParams<{ period?: string }>(),
    [period, setPeriod] = useState<Period>(
      params.period === "weekly" || params.period === "monthly"
        ? params.period
        : "daily",
    ),
    [direction, setDirection] = useState<Direction>("all"),
    [provider, setProvider] = useState(""),
    [sheet, setSheet] = useState(false),
    [cell, setCell] = useState<Change | null>(null);
  const q = useActivity(period),
    funds = useFunds(),
    map = useMemo(
      () => new Map((funds.data?.funds ?? []).map((f) => [f.fund, f])),
      [funds.data],
    );
  const source = [...(q.data?.accumulating ?? []), ...(q.data?.reducing ?? [])];
  const filtered = source.filter(
    (r) =>
      (!provider || map.get(r.fund)?.provider === provider) &&
      (direction === "all" ||
        (r.activeWeightDelta != null &&
          (direction === "buying"
            ? r.activeWeightDelta > 0
            : r.activeWeightDelta < 0))),
  );
  const rows = matrixRows(filtered),
    columns = [...new Set(filtered.map((r) => r.fund))].sort(
      (a, b) =>
        (map.get(a)?.provider ?? a).localeCompare(map.get(b)?.provider ?? b) ||
        a.localeCompare(b),
    );
  return (
    <Screen
      topInset={false}
      refreshing={q.isRefetching}
      onRefresh={() => {
        q.refetch();
        funds.refetch();
      }}
    >
      <Title>Activity matrix</Title>
      <Hint>
        {pluralize(rows.length, "ticker")} × {pluralize(columns.length, "fund")} · significant equity
        moves
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
      <Segmented
        value={direction}
        onChange={setDirection}
        options={[
          { value: "all", label: "All" },
          { value: "buying", label: "Buying" },
          { value: "selling", label: "Selling" },
        ]}
      />
      <Action onPress={() => setSheet(true)}>
        {provider || "All providers"} · Filter
      </Action>
      <Note>
        Swipe fund columns →. Tickers stay pinned. Tap any cell for the full
        change. NEW / EXIT are position identities; ADD / TRIM are active-weight
        direction. Empty means no significant move, not zero exposure.
      </Note>
      <QueryStatus q={q} />
      {q.data && rows.length === 0 && (
        <Note>No significant equity activity matches.</Note>
      )}
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 92, backgroundColor: c.canvas }}>
          <View style={{ height: 60, justifyContent: "center" }}>
            <Mono bold>Ticker</Mono>
          </View>
          {rows.map((r) => (
            <Pressable
              key={r.ticker}
              onPress={() =>
                router.push(`/ticker/${encodeURIComponent(r.ticker)}`)
              }
              style={{
                height: 60,
                justifyContent: "center",
                borderBottomWidth: 1,
                borderColor: c.border,
              }}
            >
              <Mono bold>{r.ticker}</Mono>
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal>
          <View>
            <View style={{ flexDirection: "row" }}>
              {columns.map((f) => (
                <Pressable
                  key={f}
                  onPress={() => router.push(`/fund/${encodeURIComponent(f)}`)}
                  style={{
                    width: 110,
                    height: 60,
                    justifyContent: "center",
                    padding: 6,
                  }}
                >
                  <Hint>{map.get(f)?.provider ?? "Provider unknown"}</Hint>
                  <Mono bold>{f}</Mono>
                </Pressable>
              ))}
            </View>
            {rows.map((r) => (
              <View key={r.ticker} style={{ flexDirection: "row" }}>
                {columns.map((f) => {
                  const v = r.cells.get(f);
                  return (
                    <Pressable
                      key={f}
                      disabled={!v}
                      onPress={() => v && setCell(v)}
                      accessibilityLabel={
                        v
                          ? `${r.ticker} ${f} ${moveType(v)} ${formatPp(v.activeWeightDelta)}`
                          : `${r.ticker} ${f}: no significant move`
                      }
                      style={{
                        width: 110,
                        height: 60,
                        padding: 5,
                        borderBottomWidth: 1,
                        borderColor: c.border,
                        justifyContent: "center",
                        backgroundColor: v
                          ? v.activeWeightDelta! > 0
                            ? c.buy + "15"
                            : c.sell + "15"
                          : c.card,
                      }}
                    >
                      {v ? (
                        <>
                          <Text
                            style={{
                              color: deltaColor(v.activeWeightDelta, c),
                              fontSize: 11,
                            }}
                          >
                            {moveLabel(moveType(v))}
                          </Text>
                          <Mono style={{ fontSize: 12 }}>
                            {formatPp(v.activeWeightDelta)}
                          </Mono>
                        </>
                      ) : (
                        <Hint>—</Hint>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <FilterSheet
        visible={sheet}
        title="Matrix provider"
        onClose={() => setSheet(false)}
        onReset={() => setProvider("")}
        applyLabel={`Show ${pluralize(rows.length, "ticker")}`}
      >
        <OptionGroup
          label="Provider"
          value={provider}
          onChange={setProvider}
          options={[
            { value: "", label: "All providers" },
            ...[...new Set([...map.values()].map((r) => r.provider))]
              .sort()
              .map((value) => ({ value, label: value })),
          ]}
        />
      </FilterSheet>
      <Modal visible={!!cell} transparent onRequestClose={() => setCell(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: c.overlay,
            justifyContent: "center",
            padding: 18,
          }}
        >
          {cell && (
            <ChangeCard
              row={cell}
              fund={map.get(cell.fund)}
              onPress={() => {
                setCell(null);
                router.push(`/fund/${encodeURIComponent(cell.fund)}`);
              }}
            />
          )}
          <View style={{ backgroundColor: c.card, padding: 10 }}>
            <Action onPress={() => setCell(null)}>Close change</Action>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
