import { useState, type ReactNode } from "react";
import { router } from "expo-router";
import {
  FlatList,
  useWindowDimensions,
  SectionList,
  type SectionListData,
  type SectionListRenderItem,
  Pressable,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { columnStyle } from "@/lib/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Hint, Mono, Note, Tappable, Badge, FreshnessLabel } from "./ui";
import { useTheme } from "@/lib/theme-context";
import { fonts, deltaColor } from "@/lib/theme";
import {
  cleanName,
  formatShareMove,
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
  dense = false,
}: {
  data: T[];
  header: ReactNode;
  renderItem: ListRenderItem<T>;
  keyFor: (v: T) => string;
  refreshing?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
  empty?: string;
  dense?: boolean;
}) {
  const c = useTheme(),
    insets = useSafeAreaInsets(),
    { width } = useWindowDimensions();
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
          gap: dense ? 0 : 10,
          ...columnStyle(width, "table"),
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
function ChangeDetails({
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
  const shareMove = formatShareMove(row.previousShares, row.currentShares);
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
      {shareMove ? <Hint>{shareMove}</Hint> : null}
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
      {row.activeWeightDelta == null && (
        <Hint>One-day change unknown; never counted as a move.</Hint>
      )}
      {fund?.catchUp && (
        <Hint>Fund refreshed after a carried-forward gap.</Hint>
      )}
    </Card>
  );
}

/** Two-line broker row; details remain available on expansion, never deleted. */
export function DenseRow({
  label,
  top,
  bottom,
  rightTop,
  rightBottom,
  expanded,
  onPress,
  children,
}: {
  label: string;
  top: ReactNode;
  bottom: ReactNode;
  rightTop: ReactNode;
  rightBottom: ReactNode;
  expanded: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderColor: c.border,
        backgroundColor: c.canvas,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={{
          height: 64,
          justifyContent: "center",
          gap: 5,
          paddingHorizontal: 2,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              overflow: "hidden",
            }}
          >
            {top}
          </View>
          {rightTop}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1, minWidth: 0 }}>{bottom}</View>
          {rightBottom}
        </View>
      </Pressable>
      {expanded && (
        <View style={{ paddingVertical: 8, gap: 8 }}>{children}</View>
      )}
    </View>
  );
}
export function RowBadge({ label, color }: { label: string; color: string }) {
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: 9,
        lineHeight: 13,
        color,
        borderColor: color,
        borderWidth: 1,
        borderRadius: 3,
        paddingHorizontal: 3,
      }}
    >
      {label}
    </Text>
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
    [expanded, setExpanded] = useState(false),
    kind = moveType(row);
  const money = resolveUsd({
    apiUsd: row.activeFlowUsd,
    weightPercent: row.activeWeightDelta,
    aumBillions: fund?.aum,
  });
  const provider = fund?.provider ?? "Provider unknown";
  return (
    <DenseRow
      label={`${row.ticker}, ${kind}, ${formatPp(row.activeWeightDelta)}, ${row.fund}, ${provider}, ${formatWeight(row.previousWeight)} to ${formatWeight(row.currentWeight)}, ${formatUsdValue(money)} flow${fund?.stale ? ", older disclosure" : ""}. ${expanded ? "Collapse" : "Expand"} details`}
      expanded={expanded}
      onPress={() => setExpanded(!expanded)}
      top={
        <>
          <Mono bold style={{ fontSize: 14 }}>
            {row.ticker}
          </Mono>
          <RowBadge
            label={kind}
            color={
              kind === "NEW" ? c.isNew : deltaColor(row.activeWeightDelta, c)
            }
          />
          {fund?.stale && <RowBadge label="STALE" color={c.stale} />}
        </>
      }
      rightTop={
        <Mono
          bold
          style={{ fontSize: 13, color: deltaColor(row.activeWeightDelta, c) }}
        >
          {formatPp(row.activeWeightDelta)}
        </Mono>
      }
      bottom={
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 11,
              fontFamily: fonts.body,
              color: c.textSecondary,
            }}
          >
            {row.fund} · {provider}
          </Text>
          <Text
            style={{
              fontSize: 11,
              fontFamily: fonts.mono,
              color: c.textSecondary,
            }}
          >
            {formatWeight(row.previousWeight)} →{" "}
            {formatWeight(row.currentWeight)}
          </Text>
        </View>
      }
      rightBottom={
        <Text
          style={{ fontSize: 11, fontFamily: fonts.mono, color: c.textMuted }}
        >
          {formatUsdValue(money)} flow
        </Text>
      }
    >
      <ChangeDetails row={row} fund={fund} onPress={onPress} />
    </DenseRow>
  );
}
export function SectionPage<T extends { id: string }>({
  sections,
  header,
  renderItem,
  refreshing,
  onRefresh,
  children,
  showHeaders = true,
}: {
  sections: SectionListData<T, { title: string }>[];
  header: ReactNode;
  renderItem: SectionListRenderItem<T, { title: string }>;
  refreshing?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
  showHeaders?: boolean;
}) {
  const c = useTheme(),
    insets = useSafeAreaInsets(),
    { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <SectionList
        sections={sections}
        renderItem={renderItem}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={showHeaders}
        initialNumToRender={15}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing ?? false}
        onRefresh={onRefresh}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: 8,
          paddingBottom: insets.bottom + 28,
          ...columnStyle(width, "table"),
        }}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 8 }}>{header}</View>
        }
        renderSectionHeader={({ section }) =>
          showHeaders ? (
            <View
              accessibilityRole="header"
              testID={`discovery-section-${section.title}`}
              style={{
                backgroundColor: c.canvas,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderColor: c.border,
              }}
            >
              <Text
                style={{
                  color: c.textSecondary,
                  fontFamily: fonts.bodyBold,
                  fontSize: 12,
                }}
              >
                {section.title}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={<Note>No rows match these filters.</Note>}
      />
      {children}
    </View>
  );
}
