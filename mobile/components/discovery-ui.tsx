import type { ReactNode } from "react";
import { router } from "expo-router";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Hint, Mono, Note, Tappable, Badge, FreshnessLabel } from "./ui";
import { useTheme } from "@/lib/theme-context";
import { fonts, deltaColor } from "@/lib/theme";
import {
  cleanName,
  formatPp,
  formatWeight,
  formatUsdValue,
  resolveUsd,
  freshnessLabel,
} from "@/lib/format";
import { moveType } from "@/lib/discovery/derive";
import type { Change, FundSummary } from "@/lib/types";
export function Action({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 16,
      }}
    >
      <Text
        style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 13 }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function Title({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text
      style={{ color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 30 }}
    >
      {children}
    </Text>
  );
}
export function Search({
  value,
  onChange,
  placeholder = "Search ticker, name or fund",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  const c = useTheme();
  return (
    <TextInput
      accessibilityLabel={placeholder}
      placeholder={placeholder}
      placeholderTextColor={c.textMuted}
      value={value}
      onChangeText={onChange}
      autoCorrect={false}
      style={{
        color: c.textPrimary,
        minHeight: 48,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 12,
        fontFamily: fonts.body,
      }}
    />
  );
}
export function ListPage<T>({
  data,
  header,
  renderItem,
  keyFor,
  refreshing,
  onRefresh,
  children,
  empty = "No rows match these filters.",
}: {
  data: T[];
  header: ReactNode;
  renderItem: ListRenderItem<T>;
  keyFor: (v: T) => string;
  refreshing?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
  empty?: string;
}) {
  const c = useTheme(),
    insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={data}
        renderItem={renderItem}
        keyExtractor={keyFor}
        refreshing={refreshing ?? false}
        onRefresh={onRefresh}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={15}
        windowSize={7}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: 8,
          paddingBottom: insets.bottom + 28,
          gap: 10,
        }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 10 }}>{header}</View>
        }
        ListEmptyComponent={
          <Card>
            <Note>{empty}</Note>
          </Card>
        }
      />
      {children}
    </View>
  );
}
export function ChangeCard({
  row,
  fund,
  onPress,
}: {
  row: Change;
  fund?: FundSummary & { catchUp?: boolean; catchUpSince?: string | null };
  onPress?: () => void;
}) {
  const c = useTheme(),
    kind = moveType(row);
  const money = resolveUsd({
    apiUsd: row.activeFlowUsd,
    weightPercent: row.activeWeightDelta,
    aumBillions: fund?.aum,
  });
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Tappable
          onPress={() =>
            router.push(`/ticker/${encodeURIComponent(row.ticker)}`)
          }
          style={{ flex: 1 }}
        >
          <Mono bold>{row.ticker}</Mono>
          <Hint>{cleanName(row.name)}</Hint>
        </Tappable>
        <Badge
          label={kind}
          color={
            kind === "NEW" ? c.isNew : deltaColor(row.activeWeightDelta, c)
          }
        />
      </View>
      <Tappable
        onPress={
          onPress ??
          (() => router.push(`/fund/${encodeURIComponent(row.fund)}`))
        }
      >
        <Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>
          {row.fund}
          {fund?.provider ? ` · ${fund.provider}` : ""} →
        </Text>
      </Tappable>
      <Hint>{row.sector || "Sector not reported"}</Hint>
      <Text
        style={{ color: c.textSecondary, fontFamily: fonts.mono, fontSize: 13 }}
      >
        {formatWeight(row.previousWeight)} → {formatWeight(row.currentWeight)}
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Mono bold style={{ color: deltaColor(row.activeWeightDelta, c) }}>
          {formatPp(row.activeWeightDelta)}
        </Mono>
        <Hint>{formatUsdValue(money)} flow</Hint>
      </View>
      {fund?.stale && (
        <FreshnessLabel
          freshness={freshnessLabel({
            stale: fund.stale,
            date: fund.lastHoldingsDate,
          })}
        />
      )}
      <Hint>
        {row.activeWeightDelta == null
          ? "One-day change unknown; never counted as a move."
          : "Active weight · drift adjusted"}
        {fund?.catchUp ? " · fund refreshed after a carried-forward gap" : ""}
      </Hint>
    </Card>
  );
}
