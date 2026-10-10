import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Mono, ThinBar, Tappable } from "@/components/ui";
import { hasNewPosition, sumActive } from "@/lib/derive";
import { cleanName, formatPp } from "@/lib/format";
import { fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import type { Signal } from "@/lib/types";

export function SignalRow({ signal, conviction }: { signal: Signal; conviction: number }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const delta = sumActive(signal);
  const color = signal.direction === "buying" ? c.buy : c.sell;
  return (
    <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(signal.ticker)}`)} style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Mono bold style={styles.ticker}>{signal.ticker}</Mono>
          {hasNewPosition(signal) && <Badge label="NEW" color={c.isNew} />}
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {cleanName(signal.name)} · {signal.fundCount} {signal.fundCount === 1 ? "fund" : "funds"}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", width: 96, gap: 6 }}>
        <Mono bold style={{ color, fontSize: 15 }}>{formatPp(delta)}</Mono>
        <View style={{ width: 72 }} accessibilityLabel={`Conviction ${Math.round(conviction * 100)} percent of top`}>
          <ThinBar fraction={conviction} color={color} />
        </View>
      </View>
    </Tappable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
    ticker: { fontSize: 20 },
    name: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  });
