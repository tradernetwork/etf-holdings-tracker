import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Card, ErrorNote, Loading, Mono, Note, Screen, SectionHeader, StatTile, ThinBar, Tappable } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { changesForFund } from "@/lib/derive";
import { cleanName, formatPp, formatShortDate, formatUsd, formatUsdValue, formatWeight, fundAumUsd, resolveUsd } from "@/lib/format";
import { useFund } from "@/lib/queries";
import { colors, deltaColor, fonts, radii, spacing } from "@/lib/theme";

const CHANGES_SHOWN = 12;
const HOLDINGS_SHOWN = 10;

export default function FundScreen() {
  const { fund: raw } = useLocalSearchParams<{ fund: string }>();
  const symbol = String(raw ?? "").toUpperCase();
  const q = useFund(symbol);

  if (q.isLoading) return <Screen topInset={false}><Loading /></Screen>;
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Screen topInset={false}>
        {notFound ? (
          <Card><Mono bold style={{ fontSize: 22 }}>{symbol}</Mono><Note>{symbol} isn&apos;t a fund we track.</Note></Card>
        ) : (
          <ErrorNote message="Couldn't load this fund." onRetry={() => q.refetch()} />
        )}
      </Screen>
    );
  }

  const f = q.data;
  const aum = fundAumUsd(f);
  // The fund payload's changes are filtered again here: a row for another fund must never show on this screen.
  const changes = changesForFund(f.recentChanges, f.fund);
  const top = f.topHoldings.slice(0, HOLDINGS_SHOWN);
  const maxW = Math.max(0.0001, ...top.map((h) => h.weight));

  return (
    <Screen topInset={false}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Mono bold style={{ fontSize: 32 }}>{f.fund}</Mono>
          <Text style={styles.meta}>{f.provider}</Text>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{f.category === "active-equity" ? "Active Equity" : "Option-Income"}</Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Mono bold style={{ fontSize: 22 }}>{formatUsd(aum)}</Mono>
          <Text style={styles.hint}>assets under mgmt</Text>
        </View>
      </View>

      {f.stale && (
        <Card style={{ borderColor: colors.stale, gap: 4 }}>
          <Text style={{ color: colors.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 }}>
            Older disclosure · {formatShortDate(f.holdingsDate)}
          </Text>
          <Note>
            This provider hasn&apos;t published a newer holdings file than {formatShortDate(f.holdingsDate)} (other funds are as of{" "}
            {formatShortDate(f.asOfDate)}). That is a gap in the data, not a sign the fund stopped trading.
          </Note>
        </Card>
      )}

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <StatTile label="Holdings" value={String(f.holdingsCount)} />
        <StatTile label="Options" value={String(f.optionsCount)} color={colors.accent} />
        <StatTile label="Total wt" value={formatWeight(f.totalWeight)} />
      </View>

      <SectionHeader title="Today's changes" right={<Text style={styles.hint}>{f.stale ? `files as of ${formatShortDate(f.holdingsDate)}` : "active weight"}</Text>} />
      {changes.length === 0 ? (
        <Card><Note>{f.stale ? `No changes to show: the latest file we have is from ${formatShortDate(f.holdingsDate)}.` : "No position changes in the latest file."}</Note></Card>
      ) : (
        <Card style={{ paddingVertical: spacing.sm, gap: 0 }}>
          {changes.slice(0, CHANGES_SHOWN).map((c) => {
                        const usd = resolveUsd({ apiUsd: c.activeFlowUsd, weightPercent: c.activeWeightDelta, aumBillions: f.aum });
            return (
              <Tappable key={c.ticker + c.type} onPress={() => router.push(`/ticker/${encodeURIComponent(c.ticker)}`)} style={styles.row}>
                <View style={{ flex: 1, gap: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Mono bold style={{ fontSize: 16 }}>{c.ticker}</Mono>
                    {c.type === "NEW" && <Badge label="NEW" color={colors.isNew} />}
                    {c.type === "REMOVED" && <Badge label="EXIT" color={colors.sell} />}
                  </View>
                  <Text style={styles.hint} numberOfLines={1}>{cleanName(c.name)}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Mono bold style={{ fontSize: 14, color: deltaColor(c.activeWeightDelta) }}>{formatPp(c.activeWeightDelta)}</Mono>
                  <Text style={styles.hint}>{formatUsdValue(usd)}</Text>
                </View>
              </Tappable>
            );
          })}
          {changes.length > CHANGES_SHOWN && <Text style={[styles.hint, { paddingTop: spacing.sm }]}>+{changes.length - CHANGES_SHOWN} smaller changes</Text>}
        </Card>
      )}

      <SectionHeader title="Top holdings" right={<Text style={styles.hint}>weight in fund</Text>} />
      {top.length === 0 ? (
        <Card><Note>No stock holdings reported{f.optionsCount > 0 ? "; this fund's book is options" : ""}.</Note></Card>
      ) : (
        <Card style={{ paddingVertical: spacing.sm, gap: 0 }}>
          {top.map((h) => (
            <Tappable key={h.ticker} onPress={() => router.push(`/ticker/${encodeURIComponent(h.ticker)}`)} style={styles.holding}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Mono bold style={{ fontSize: 15 }}>{h.ticker}</Mono>
                  <Text style={styles.hint} numberOfLines={1}>{cleanName(h.name)}</Text>
                </View>
                <Mono style={{ fontSize: 13 }}>{formatWeight(h.weight)}</Mono>
              </View>
              <ThinBar fraction={h.weight / maxW} color={colors.accent} />
            </Tappable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 },
  chip: { alignSelf: "flex-start", marginTop: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { color: colors.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  holding: { paddingVertical: spacing.sm, gap: 6, justifyContent: "center" },
});
