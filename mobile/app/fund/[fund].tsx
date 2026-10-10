import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MinorAdjustments } from "@/components/minor-adjustments";
import { Badge, Card, ErrorNote, Hint, Loading, Monogram, Mono, Note, Screen, SectionHeader, ThinBar, Tappable } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { changesForFund } from "@/lib/derive";
import { partitionSignificant } from "@/lib/significance";
import { cleanName, formatPp, formatShortDate, formatUsd, formatUsdValue, formatWeight, fundAumUsd, resolveUsd } from "@/lib/format";
import { useFund } from "@/lib/queries";
import { deltaColor, display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const CHANGES_SHOWN = 12;
const HOLDINGS_SHOWN = 10;

export default function FundScreen() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { fund: raw } = useLocalSearchParams<{ fund: string }>();
  const symbol = String(raw ?? "").toUpperCase();
  const q = useFund(symbol);
  const { isFollowing, toggleFollow } = useAppState();

  if (q.isLoading) return <Screen topInset={false}><Loading /></Screen>;
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Screen topInset={false}>
        {notFound ? (
          <Card><Text style={styles.symbol}>{symbol}</Text><Note>{symbol} isn&apos;t a fund we track.</Note></Card>
        ) : (
          <ErrorNote message="Couldn't load this fund." onRetry={() => q.refetch()} />
        )}
      </Screen>
    );
  }

  const f = q.data;
  const aum = fundAumUsd(f);
  // The fund payload's changes are filtered again here: a row for another fund must never show on this screen.
  const { significant: changes, minor } = partitionSignificant(changesForFund(f.recentChanges, f.fund));
  const top = f.topHoldings.slice(0, HOLDINGS_SHOWN);
  const maxW = Math.max(0.0001, ...top.map((h) => h.weight));
  const income = f.category === "option-income";

  return (
    <Screen topInset={false}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{income ? "INCOME & OPTIONS" : "STOCK ACTIVITY"}</Text>
          <Text style={styles.symbol}>{f.fund}</Text>
          <Text style={styles.provider}>{f.provider}</Text>
          <Pressable
            onPress={() => toggleFollow("fund", symbol)}
            accessibilityRole="button"
            accessibilityState={{ selected: isFollowing("fund", symbol) }}
            style={[styles.follow, isFollowing("fund", symbol) && { backgroundColor: c.accent + "22", borderColor: c.accent }]}
          >
            <Ionicons name={isFollowing("fund", symbol) ? "star" : "star-outline"} size={15} color={isFollowing("fund", symbol) ? c.accent : c.textSecondary} />
            <Text style={[styles.followText, isFollowing("fund", symbol) && { color: c.accent }]}>{isFollowing("fund", symbol) ? "Following" : "Follow"}</Text>
          </Pressable>
        </View>
        <Monogram label={f.provider.slice(0, 3).toUpperCase()} />
      </View>

      <View style={styles.statGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{formatUsd(aum)}</Text>
          <Hint>Assets under management</Hint>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{f.holdingsCount}</Text>
          <Hint>Disclosed holdings{f.optionsCount > 0 ? ` · ${f.optionsCount} options` : ""}</Hint>
        </View>
      </View>

      {f.catchUpSince ? (
        <View style={styles.warn}>
          <Ionicons name="time-outline" size={20} color={c.warnText} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.warnTitle}>Catch-up since {formatShortDate(f.catchUpSince)}</Text>
            <Text style={styles.warnBody}>This fund&apos;s previous file was carried forward, so its latest diff spans several days and is not shown as a one-day change.</Text>
          </View>
        </View>
      ) : null}

      {f.stale && (
        <View style={styles.warn}>
          <Ionicons name="time-outline" size={20} color={c.warnText} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.warnTitle}>Older disclosure · {formatShortDate(f.holdingsDate)}</Text>
            <Text style={styles.warnBody}>
              The {formatShortDate(f.asOfDate)} snapshot carries this book forward. These positions are not fresh trade signals.
              {" "}<Text style={{ fontFamily: fonts.bodyBold }}>Quiet data is not proof of no trades.</Text>
            </Text>
          </View>
        </View>
      )}

      {!f.stale && !f.catchUpSince && (
        <>
          <SectionHeader title="Today's changes" right={<Hint>active weight</Hint>} />
          {changes.length === 0 ? (
            <Card><Note>No significant position changes in the latest file.</Note></Card>
          ) : (
            <View>
              {changes.slice(0, CHANGES_SHOWN).map((ch) => {
                const usd = resolveUsd({ apiUsd: ch.activeFlowUsd, weightPercent: ch.activeWeightDelta, aumBillions: f.aum });
                return (
                  <Tappable key={ch.ticker + ch.type} onPress={() => router.push(`/ticker/${encodeURIComponent(ch.ticker)}`)} style={styles.row}>
                    <Monogram label={ch.ticker} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.rowTitle}>{ch.ticker}</Text>
                        {ch.type === "NEW" && <Badge label="NEW" color={c.isNew} />}
                        {ch.type === "REMOVED" && <Badge label="EXIT" color={c.sell} />}
                      </View>
                      <Hint>{cleanName(ch.name)}</Hint>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Mono bold style={{ fontSize: 14, color: deltaColor(ch.activeWeightDelta, c) }}>{formatPp(ch.activeWeightDelta)}</Mono>
                      <Hint>{formatUsdValue(usd)}</Hint>
                    </View>
                  </Tappable>
                );
              })}
              {changes.length > CHANGES_SHOWN && <Hint style={{ paddingTop: spacing.sm }}>+{changes.length - CHANGES_SHOWN} more significant changes</Hint>}
            </View>
          )}
          <MinorAdjustments rows={minor} labelKey="ticker" />
        </>
      )}

      <SectionHeader title={f.stale ? "Largest disclosed positions" : "Largest positions"} right={<Hint>{f.stale ? formatShortDate(f.holdingsDate) : "weight in fund"}</Hint>} />
      {top.length === 0 ? (
        <Card><Note>No stock holdings reported{f.optionsCount > 0 ? "; this fund's book is options" : ""}.</Note></Card>
      ) : (
        <View>
          {top.map((h) => (
            <Tappable key={h.ticker} onPress={() => router.push(`/ticker/${encodeURIComponent(h.ticker)}`)} style={styles.row}>
              <Monogram label={h.ticker} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{h.ticker}</Text>
                    <Hint>{cleanName(h.name)}</Hint>
                  </View>
                  <Mono style={{ fontSize: 13 }}>{formatWeight(h.weight)}</Mono>
                </View>
                <ThinBar fraction={h.weight / maxW} color={c.accent} />
              </View>
            </Tappable>
          ))}
        </View>
      )}
      {f.stale && (
        <Text style={styles.empty}>No fresh disclosure to compare.{"\n"}<Text style={{ fontFamily: fonts.bodyBold }}>Quiet data is not proof of no trades.</Text></Text>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    eyebrow: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4 },
    symbol: { ...display, color: c.textPrimary, fontSize: 56, lineHeight: 60, marginTop: spacing.xs },
    provider: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 14 },
    follow: {
      flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: spacing.md, minHeight: MIN_TAP, paddingHorizontal: spacing.md,
      borderWidth: 1, borderColor: c.border, borderRadius: radii.pill, backgroundColor: c.card,
    },
    followText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 13 },
    statGrid: { flexDirection: "row", gap: spacing.sm },
    statCell: { flex: 1, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg, gap: 4 },
    statValue: { ...display, color: c.textPrimary, fontSize: 30, letterSpacing: -1 },
    warn: { flexDirection: "row", gap: spacing.md, backgroundColor: c.warnBg, borderColor: c.warnBorder, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg },
    warnTitle: { color: c.warnText, fontFamily: fonts.bodyBold, fontSize: 14 },
    warnBody: { color: c.warnText, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: c.border, borderBottomWidth: 1 },
    rowTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    empty: { color: c.textMuted, fontFamily: fonts.body, fontSize: 13, textAlign: "center", lineHeight: 20, paddingVertical: spacing.lg },
  });
