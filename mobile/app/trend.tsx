import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Action, ListPage, Title } from "@/components/discovery-ui";
import { TrendCard } from "@/components/institutional-trend";
import {
  Hint,
  Note,
  Segmented,
  SectionHeader,
  ErrorNote,
  Loading,
} from "@/components/ui";
import { useTrend } from "@/lib/discovery/api";
import { trendGroups, trendLabels } from "@/lib/discovery/derive";
import type { Horizon } from "@/lib/discovery/types";
import { formatShortDate } from "@/lib/format";
export default function Trend() {
  const [horizon, setHorizon] = useState<Horizon>("all"),
    q = useTrend();
  const rows = trendGroups(q.data?.tickers ?? [], horizon).flatMap(
    (g) => g.rows,
  );
  return (
    <ListPage
      data={rows}
      keyFor={(r) => r.ticker}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      header={
        <>
          <Title>Institutional trend</Title>
          <Action onPress={() => router.push("/institutional")}>
            Combined institutional book →
          </Action>
          <Hint>
            {formatShortDate(q.data?.asOfDate)} · {q.data?.fundCount ?? "—"}{" "}
            stock-picking funds · {rows.length} ranked names
          </Hint>
          <Segmented
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: "all", label: "All" },
              { value: "daily", label: "Day" },
              { value: "weekly", label: "Week" },
              { value: "monthly", label: "Month" },
            ]}
          />
          <Note>
            Groups use the API's accumulation/distribution signal. Within
            groups: largest absolute {horizon === "all" ? "monthly" : horizon}{" "}
            move first. Income collateral books are excluded.
          </Note>
          <Hint>
            Day/week/month are changes in AUM-blended weight, not summed active
            trading flow. Catch-up is guarded at each comparison window.
          </Hint>
          {rows.length === 50 && (
            <Note>
              Top 50 per API ranking; this is the full returned monitor, not
              every held stock.
            </Note>
          )}
          {q.isLoading && <Loading />}
          {q.isError && (
            <ErrorNote
              message="Couldn't load institutional trends."
              onRetry={() => q.refetch()}
            />
          )}
        </>
      }
      renderItem={({ item, index }) => (
        <View style={{ gap: 8 }}>
          {(index === 0 || rows[index - 1].signal !== item.signal) && (
            <SectionHeader title={trendLabels[item.signal]} />
          )}
          <TrendCard row={item} horizon={horizon} />
        </View>
      )}
    />
  );
}
