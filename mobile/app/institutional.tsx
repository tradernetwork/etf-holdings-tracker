import { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { ListPage, Title, Action } from "@/components/discovery-ui";
import { Card, Hint, Mono, Note, Segmented, Tappable, SectionHeader, QueryStatus } from "@/components/ui";
import { useInstitutional } from "@/lib/discovery/api";
import type { Period } from "@/lib/discovery/types";
import { useTheme } from "@/lib/theme-context";
import { deltaColor } from "@/lib/theme";
import {
  formatPp,
  formatUsd,
  formatWeight,
  formatShortDate,
  pluralize,
} from "@/lib/format";
export default function Institutional() {
  const c = useTheme(),
    [period, setPeriod] = useState<Period>("daily"),
    [expanded, setExpanded] = useState<string | null>(null),
    q = useInstitutional(period),
    rows = [...(q.data?.buying ?? []), ...(q.data?.selling ?? [])];
  return (
    <ListPage
      loaded={!!q.data}
      data={rows}
      keyFor={(r) => `${r.direction}:${r.ticker}`}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      header={
        <>
          <Title>Combined book</Title>
          <Hint>
            {formatShortDate(q.data?.asOfDate)} ·{" "}
            {q.data ? pluralize(q.data.fundCount, "stock-picking fund") : "—"} ·{" "}
            {q.data?.totalAum == null
              ? "AUM unknown"
              : formatUsd(q.data.totalAum * 1e9)}{" "}
            combined assets
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
          <Note>
            AUM-blended portfolio: current → previous comparison, income funds
            excluded. This measures aggregate allocations, distinct from manager
            active-flow changes.
          </Note>
          <QueryStatus q={q} />
          {(q.data?.buying.length === 100 ||
            q.data?.selling.length === 100) && (
            <Note>Top 100 per direction, the API's supported limit.</Note>
          )}
        </>
      }
      renderItem={({ item: r, index }) => (
        <View style={{ gap: 8 }}>
          {(index === 0 || rows[index - 1].direction !== r.direction) && (
            <SectionHeader
              title={
                r.direction === "buying"
                  ? "Institutions buying"
                  : "Institutions selling"
              }
            />
          )}
          <Card>
            <Tappable
              onPress={() =>
                router.push(`/ticker/${encodeURIComponent(r.ticker)}`)
              }
            >
              <Mono bold>{r.ticker} →</Mono>
              <Hint>
                {r.name} · {r.sector || "Sector not reported"}
              </Hint>
            </Tappable>
            <Mono style={{ color: deltaColor(r.weightDelta, c) }}>
              {formatPp(r.weightDelta)}
            </Mono>
            <Hint>
              {formatWeight(r.previousBlendedWeight)} →{" "}
              {formatWeight(r.blendedWeight)} blended weight ·{" "}
              {r.fundCount === 0 ? "Fully exited" : pluralize(r.fundCount, "fund")}
            </Hint>
            <Action
              onPress={() =>
                setExpanded(expanded === r.ticker ? null : r.ticker)
              }
            >
              {expanded === r.ticker
                ? "Hide funds"
                : `View all ${r.funds.length} fund links`}
            </Action>
            {expanded === r.ticker && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {r.funds.map((f) => (
                  <Action
                    key={f}
                    onPress={() =>
                      router.push(`/fund/${encodeURIComponent(f)}`)
                    }
                  >
                    {f}
                  </Action>
                ))}
              </View>
            )}
          </Card>
        </View>
      )}
    />
  );
}
