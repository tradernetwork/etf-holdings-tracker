import { useLocalSearchParams } from "expo-router";
import { useState, useMemo } from "react";
import { ListPage, ChangeCard, Title } from "@/components/discovery-ui";
import { ErrorNote, Loading, Note, Segmented, Hint } from "@/components/ui";
import { useTicker, useFunds } from "@/lib/queries";
import { filterChanges, emptyChangeFilters } from "@/lib/discovery/derive";
import type { Direction } from "@/lib/discovery/types";
import { isSignificant } from "@/lib/significance";
export default function Evidence() {
  const { symbol: raw } = useLocalSearchParams<{ symbol: string }>(),
    symbol = String(raw ?? "").toUpperCase(),
    q = useTicker(symbol),
    funds = useFunds(),
    [direction, setDirection] = useState<Direction>("all");
  const map = useMemo(
    () => new Map((funds.data?.funds ?? []).map((f) => [f.fund, f])),
    [funds.data],
  );
  const rows = filterChanges(
    q.data?.changes ?? [],
    { ...emptyChangeFilters, direction },
    map,
  );
  return (
    <ListPage
      dense
      data={rows}
      keyFor={(r) => `${r.fund}:${r.ticker}:${r.type}`}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      header={
        <>
          <Title>{symbol} evidence</Title>
          <Hint>
            All {rows.length} stock-position changes (all fund categories) ·{" "}
            {
              rows.filter((r) => isSignificant(r.fund, r.activeWeightDelta))
                .length
            }{" "}
            significant
          </Hint>
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: "all", label: "All" },
              { value: "buying", label: "Adding" },
              { value: "selling", label: "Reducing" },
            ]}
          />
          <Note>
            Active Δ is drift adjusted; dollar flow is estimated. Tap any row for full details, including smaller adjustments.
            Null deltas are unknown; older holdings are not proof of no trades.
          </Note>
          {q.isLoading && <Loading />}
          {q.isError && (
            <ErrorNote
              message="Couldn't load ticker evidence."
              onRetry={() => q.refetch()}
            />
          )}
        </>
      }
      renderItem={({ item }) => (
        <ChangeCard row={item} fund={map.get(item.fund)} />
      )}
    />
  );
}
