import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFunds, useSignals } from "@/lib/queries";
import { colors, MIN_TAP, radii, spacing } from "@/lib/theme";
import type { Signal } from "@/lib/types";

type Row = { kind: "header"; label: string; direction: "buying" | "selling" } | { kind: "signal"; signal: Signal };

export default function Today() {
  const insets = useSafeAreaInsets();
  const signals = useSignals();
  const funds = useFunds();

  const rows: Row[] = signals.data
    ? [
        { kind: "header", label: "Buying", direction: "buying" },
        ...signals.data.signals.buying.map((signal): Row => ({ kind: "signal", signal })),
        { kind: "header", label: "Selling", direction: "selling" },
        ...signals.data.signals.selling.map((signal): Row => ({ kind: "signal", signal })),
      ]
    : [];
  const staleFunds = funds.data?.funds.filter((f) => f.stale).length ?? 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === "header" ? `h-${r.direction}` : `${r.signal.direction}-${r.signal.ticker}-${i}`)}
        refreshing={signals.isRefetching}
        onRefresh={() => {
          signals.refetch();
          funds.refetch();
        }}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        ListHeaderComponent={
          <View style={styles.head}>
            <Text style={styles.title}>Today</Text>
            {signals.data && (
              <Text style={styles.sub}>
                Data as of {signals.data.asOfDate}
                {staleFunds > 0 ? ` · ${staleFunds} of ${funds.data?.funds.length} funds not yet updated` : ""}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          signals.isLoading ? (
            <ActivityIndicator color={colors.equity} style={{ marginTop: spacing.xxl }} />
          ) : signals.isError ? (
            <View style={styles.head}>
              <Text style={styles.sub}>Couldn&apos;t load signals. Check your connection.</Text>
              <Pressable onPress={() => signals.refetch()} style={styles.retry} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <Text style={[styles.section, { color: item.direction === "buying" ? colors.buy : colors.sell }]}>
              {item.label.toUpperCase()}
            </Text>
          ) : (
            <SignalRow signal={item.signal} />
          )
        }
      />
    </View>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const up = signal.direction === "buying";
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.ticker}>{signal.ticker}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {signal.name} · {signal.fundCount} {signal.fundCount === 1 ? "fund" : "funds"}
        </Text>
      </View>
      <Text style={[styles.delta, { color: up ? colors.buy : colors.sell }]}>
        {signal.weightDelta > 0 ? "+" : ""}
        {signal.weightDelta.toFixed(3)}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  head: { padding: spacing.lg, gap: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: "800" },
  sub: { color: colors.textSecondary, fontSize: 13 },
  section: { fontSize: 12, fontWeight: "800", letterSpacing: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MIN_TAP + spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    gap: spacing.md,
  },
  ticker: { color: colors.equity, fontSize: 17, fontWeight: "800", fontFamily: "monospace" },
  name: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  delta: { fontSize: 16, fontWeight: "700", fontFamily: "monospace" },
  retry: { minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start" },
  retryText: { color: colors.equity, fontWeight: "700" },
});
