import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { OptionRow } from "@/components/fund/option-row";
import { Card, FreshnessLabel, Hint, Note, SectionHeader, Tappable } from "@/components/ui";
import { buildOptionHolders, type OptionHolderFund, type TickerChangeRow, type TickerHoldingRow } from "@/lib/optionHolders";
import { formatUsdValue, formatWeight, freshnessLabel } from "@/lib/format";
import { fonts, MIN_TAP, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const FUNDS_COLLAPSED = 3;
const LEGS_COLLAPSED = 4;

/**
 * Ticker screen "Option holders": every tracked fund holding options on THIS stock, with its legs
 * (long/short, contracts, strike, expiry, DTE, ITM/OTM, est. value, % of fund). Mirrors the website's
 * "Option positions on it". Renders nothing when no fund holds a live option on the symbol.
 */
export function OptionHolders({ symbol, holdings, changes }: { symbol: string; holdings: TickerHoldingRow[]; changes: TickerChangeRow[] }) {
  const built = useMemo(() => buildOptionHolders(symbol, holdings, changes), [symbol, holdings, changes]);
  const [all, setAll] = useState(false);
  const c = useTheme();
  if (built.funds.length === 0) return null;
  const shown = all ? built.funds : built.funds.slice(0, FUNDS_COLLAPSED);
  return (
    <>
      <SectionHeader
        title="Option holders"
        right={built.funds.length > FUNDS_COLLAPSED ? (
          <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: "center" }}>
            <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 12 }}>{all ? "Show fewer" : `View all ${built.funds.length} ↗`}</Text>
          </Pressable>
        ) : undefined}
      />
      <Hint>
        {built.legCount} live {built.legCount === 1 ? "leg" : "legs"} across {built.funds.length} {built.funds.length === 1 ? "fund" : "funds"} — left out of the institutional blend. Short = written. A long call and a written put at one strike together are synthetic stock, not two trades.
        {built.expiredHidden > 0 ? ` ${built.expiredHidden} expired ${built.expiredHidden === 1 ? "contract" : "contracts"} hidden.` : ""}
        {built.spot != null ? ` ITM/OTM uses an implied price of ~$${built.spot.toFixed(2)}.` : ""}
      </Hint>
      {shown.map((f) => <HolderCard key={f.fund} f={f} />)}
    </>
  );
}

function HolderCard({ f }: { f: OptionHolderFund }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const legs = open ? f.legs : f.legs.slice(0, LEGS_COLLAPSED);
  const c = useTheme();
  return (
    <Card style={{ gap: spacing.sm }}>
      <Tappable onPress={() => router.push(`/fund/${encodeURIComponent(f.fund)}`)} style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md }}>
          <Text style={styles.fund}>{f.fund} <Text style={styles.provider}>{f.provider}</Text></Text>
          <Hint>{f.legs.length} {f.legs.length === 1 ? "leg" : "legs"} · net {formatWeight(f.netWeight)} · {formatUsdValue(f.netValue)}</Hint>
        </View>
        <FreshnessLabel freshness={freshnessLabel({ stale: f.stale, date: f.fileDate })} />
        <Hint>
          {f.coveragePct != null
            ? `Written calls cover ${Math.round(f.coveragePct)}% of the ${f.sharesHeld.toLocaleString("en-US")} shares it holds`
            : f.sharesHeld > 0 ? `Also holds ${f.sharesHeld.toLocaleString("en-US")} shares` : "No shares held — options only"}
        </Hint>
      </Tappable>
      {legs.map((l) => <OptionRow key={l.key} line={l} plain />)}
      {f.legs.length > LEGS_COLLAPSED && (
        <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 13 }}>{open ? "Show fewer legs" : `Show all ${f.legs.length} legs`}</Text>
        </Pressable>
      )}
      {f.expiredHidden > 0 && <Note>{f.expiredHidden} expired {f.expiredHidden === 1 ? "contract" : "contracts"} still in the issuer's file {f.expiredHidden === 1 ? "is" : "are"} hidden.</Note>}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fund: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18 },
    provider: { color: c.textMuted, fontFamily: fonts.body, fontSize: 13 },
  });
