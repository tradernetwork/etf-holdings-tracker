import { router } from "expo-router";
import { View } from "react-native";
import { Action } from "./discovery-ui";
import {
  Card,
  Hint,
  Mono,
  Tappable,
  Loading,
  ErrorNote,
  SectionHeader,
  Note,
} from "./ui";
import { useTheme } from "@/lib/theme-context";
import { deltaColor } from "@/lib/theme";
import {
  formatPp,
  formatWeight,
  cleanName,
  formatShortDate,
} from "@/lib/format";
import { useTrend } from "@/lib/discovery/api";
import { trendLabels } from "@/lib/discovery/derive";
import type { TrendRow, Horizon } from "@/lib/discovery/types";
export function TrendCard({
  row,
  horizon = "all",
}: {
  row: TrendRow;
  horizon?: Horizon;
}) {
  const c = useTheme(),
    keys =
      horizon === "all" ? (["daily", "weekly", "monthly"] as const) : [horizon];
  return (
    <Tappable
      onPress={() => router.push(`/ticker/${encodeURIComponent(row.ticker)}`)}
    >
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Mono bold>{row.ticker} →</Mono>
          <Hint>{row.fundCount} funds</Hint>
        </View>
        <Hint>
          {cleanName(row.name)} · {row.sector || "Sector not reported"}
        </Hint>
        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          {keys.map((key) => (
            <View key={key}>
              <Hint>
                {key === "daily" ? "Day" : key === "weekly" ? "Week" : "Month"}
              </Hint>
              <Mono style={{ color: deltaColor(row[key], c) }}>
                {formatPp(row[key])}
              </Mono>
            </View>
          ))}
        </View>
        <Hint>
          {formatWeight(row.blendedWeight)} blended allocation ·{" "}
          {trendLabels[row.signal]}
        </Hint>
      </Card>
    </Tappable>
  );
}
export function TrendPreview() {
  const q = useTrend();
  return (
    <>
      <SectionHeader
        title="Institutional trend"
        right={
          <Action onPress={() => router.push("/trend")}>View all →</Action>
        }
      />
      <Hint>Stock-picking funds · {formatShortDate(q.data?.asOfDate)}</Hint>
      {q.isLoading && <Loading />}
      {q.isError && (
        <ErrorNote
          message="Couldn't load the trend."
          onRetry={() => q.refetch()}
        />
      )}{" "}
      {(q.data?.tickers ?? []).slice(0, 3).map((row) => (
        <TrendCard key={row.ticker} row={row} />
      ))}
      {q.data?.tickers.length === 0 && (
        <Note>No institutional trend rows in this snapshot.</Note>
      )}
    </>
  );
}
