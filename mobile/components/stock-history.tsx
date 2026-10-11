import { useState } from "react";
import { View } from "react-native";
import {
  Card,
  Hint,
  Mono,
  Segmented,
  SectionHeader,
  ErrorNote,
  Loading,
} from "./ui";
import { Action } from "./discovery-ui";
import { useStock } from "@/lib/discovery/api";
import { sparkline, trendLabels } from "@/lib/discovery/derive";
import type { HistoryPoint, Period } from "@/lib/discovery/types";
import {
  formatPp,
  formatShortDate,
  formatUsd,
  formatWeight,
} from "@/lib/format";
import { useTheme } from "@/lib/theme-context";
import { deltaColor } from "@/lib/theme";
export function WeightSparkline({ points }: { points: HistoryPoint[] }) {
  const c = useTheme(),
    [width, setWidth] = useState(0),
    plot = sparkline(points);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="image"
      accessibilityLabel={`${points.length} session blended-weight history: ${points.map((p) => `${p.date} ${p.blendedWeight}%`).join("; ")}`}
      style={{ height: 54, position: "relative" }}
    >
      {plot.slice(1).map((p, i) => {
        const a = plot[i],
          dx = ((p.x - a.x) / 100) * width,
          dy = p.y - a.y,
          len = Math.hypot(dx, dy);
        return (
          <View
            key={points[i + 1].date}
            style={{
              position: "absolute",
              left: (a.x / 100) * width + dx / 2 - len / 2,
              top: a.y + dy / 2 + 8,
              width: len,
              height: 2,
              backgroundColor: c.accent,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            }}
          />
        );
      })}
      {plot.length === 1 && (
        <View
          style={{
            width: 4,
            height: 4,
            backgroundColor: c.accent,
            position: "absolute",
            top: 26,
          }}
        />
      )}
    </View>
  );
}
export function StockHistory({ symbol }: { symbol: string }) {
  const c = useTheme(),
    q = useStock(symbol),
    [horizon, setHorizon] = useState<Period>("daily"),
    [sessions, setSessions] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data)
    return (
      <ErrorNote
        message="Couldn't load institutional history."
        onRetry={() => q.refetch()}
      />
    );
  const t = q.data,
    inst = t.institutional;
  return (
    <>
      <SectionHeader title="Institutional exposure" />
      <Card>
        <Mono bold>{trendLabels[inst.signal]}</Mono>
        <Hint>
          {inst.fundCount} stock-picking funds ·{" "}
          {inst.estimatedExposureM == null
            ? "Dollar exposure unknown"
            : `est. ${formatUsd(inst.estimatedExposureM * 1e6)} exposure`}
        </Hint>
        <Hint>
          {formatWeight(inst.blendedWeight)} blended allocation
          {inst.streak != null
            ? ` · ${Math.abs(inst.streak)}d ${inst.streak > 0 ? "buying" : "selling"} streak`
            : ""}
        </Hint>
        <Segmented
          value={horizon}
          onChange={setHorizon}
          options={[
            { value: "daily", label: "Day" },
            { value: "weekly", label: "Week" },
            { value: "monthly", label: "Month" },
          ]}
        />
        <Mono
          bold
          style={{ fontSize: 24, color: deltaColor(inst[horizon], c) }}
        >
          {formatPp(inst[horizon])}
        </Mono>
        <Hint>
          AUM-blended institutional weight change. Catch-up windows are guarded;
          this differs from summed active Δ below.
        </Hint>
      </Card>
      <SectionHeader
        title={`${t.history.length}-session history`}
        right={
          <Action onPress={() => setSessions(!sessions)}>
            {sessions ? "Hide sessions" : "View all sessions"}
          </Action>
        }
      />
      <Card>
        <WeightSparkline points={t.history} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Hint>{formatShortDate(t.history[0]?.date)}</Hint>
          <Hint>{formatShortDate(t.history.at(-1)?.date)}</Hint>
        </View>
        {sessions &&
          t.history.map((p) => (
            <View
              key={p.date}
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Hint>
                {formatShortDate(p.date)} · {p.fundCount} funds
              </Hint>
              <Mono>{formatWeight(p.blendedWeight)}</Mono>
            </View>
          ))}
      </Card>
    </>
  );
}
