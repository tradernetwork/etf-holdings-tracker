import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Hint, Mono, Tappable } from "@/components/ui";
import { sideLabel } from "@/lib/book";
import { contractLabel, decodeOptionSignal, formatWeightDelta, signalLabel, strategyBadge } from "@/lib/options/logic";
import type { OptionActivityRecord } from "@/lib/options/types";
import { deltaColor, fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/**
 * One option contract's change at one fund — every column of the website's options-activity table:
 * fund, contract, strategy, expiry @ strike, decoded directional view, signal, weight Δ.
 * Beyond the site: the signed contract count, so a written (short) contract reads as short.
 */
export function ActivityRow({ record: r }: { record: OptionActivityRecord }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const decoded = decodeOptionSignal(r);
  const under = r.optionDetails?.underlying;
  const isCall = strategyBadge(r) === "CC";
  const sig = signalLabel(r.type);
  const sigColor = sig === "OPENED" ? c.buy : sig === "EXPIRED" ? c.sell : c.accent;
  const wd = r.weightDelta;
  const arrow = wd > 0 ? "arrow-up" : wd < 0 ? "arrow-down" : null;
  const contracts = sideLabel(r.currentShares);
  return (
    <Tappable
      onPress={() => under && router.push(`/ticker/${encodeURIComponent(under)}`)}
      style={[styles.row, { borderLeftColor: isCall ? c.buy : c.isNew }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={2}>{contractLabel(r)}</Text>
        <View style={styles.badges}>
          <Badge label={r.fund} color={c.textSecondary} />
          <Badge label={isCall ? "CC" : "CSP"} color={isCall ? c.buy : c.isNew} />
          <Badge label={sig} color={sigColor} />
        </View>
        {decoded ? <Hint>{decoded.directionalView} · {decoded.moneyness}</Hint> : null}
        {contracts ? <Hint>{contracts}{r.sharesDelta ? ` (${r.sharesDelta > 0 ? "+" : "−"}${Math.abs(Math.round(r.sharesDelta)).toLocaleString("en-US")})` : ""}</Hint> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {arrow ? <Ionicons name={arrow} size={12} color={deltaColor(wd, c)} /> : null}
          <Mono bold style={{ fontSize: 14, color: deltaColor(wd, c) }}>{formatWeightDelta(wd)}</Mono>
        </View>
        <Hint>weight Δ</Hint>
      </View>
    </Tappable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingLeft: spacing.sm,
      borderBottomColor: c.border, borderBottomWidth: 1, borderLeftWidth: 3,
    },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 },
    badges: { flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" },
  });
