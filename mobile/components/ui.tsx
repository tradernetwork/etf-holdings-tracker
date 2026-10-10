import { Ionicons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Freshness } from "@/lib/format";
import { colors, fonts, MIN_TAP, radii, spacing } from "@/lib/theme";

/** Scrollable screen with safe-area padding and optional pull-to-refresh. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  topInset = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  topInset?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: topInset ? insets.top + spacing.lg : spacing.md,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl,
        gap: spacing.md,
      }}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

export function Mono({ children, style, bold }: { children: ReactNode; style?: StyleProp<TextStyle>; bold?: boolean }) {
  return <Text style={[{ fontFamily: bold ? fonts.monoBold : fonts.mono, color: colors.textPrimary }, style]}>{children}</Text>;
}

export function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.tile}>
      <Mono bold style={{ fontSize: 20, color: color ?? colors.textPrimary }}>{value}</Mono>
      <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && { color: colors.textPrimary }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + "26", borderColor: color + "66" }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

/** Thin 0..1 bar (conviction, weight). */
export function ThinBar({ fraction, color, height = 3 }: { fraction: number; color: string; height?: number }) {
  const w = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` as const;
  return (
    <View style={{ height, backgroundColor: colors.border, borderRadius: height, overflow: "hidden" }}>
      <View style={{ width: w, height, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function FreshnessLabel({ freshness }: { freshness: Freshness }) {
  if (!freshness.text) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {freshness.stale && <Ionicons name="time-outline" size={12} color={colors.stale} />}
      <Text style={{ color: colors.stale, fontSize: 11, fontFamily: fonts.body }}>{freshness.text}</Text>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

export function Loading() {
  return <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.xl }} />;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <Text style={styles.note}>{message}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
        <Text style={{ color: colors.accent, fontFamily: fonts.bodyBold }}>Try again</Text>
      </Pressable>
    </Card>
  );
}

/** Row that navigates; min 44dp tall. */
export function Tappable({
  onPress,
  children,
  style,
}: {
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, minHeight: MIN_TAP }, style]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingVertical: spacing.md,
    alignItems: "center",
    gap: 2,
  },
  tileLabel: { color: colors.textMuted, fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 0.8 },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    padding: 3,
  },
  segment: { flex: 1, minHeight: MIN_TAP - 6, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.sm },
  segmentOn: { backgroundColor: colors.border },
  segmentText: { color: colors.textMuted, fontFamily: fonts.bodyMedium, fontSize: 13 },
  badge: { borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.6 },
  note: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start" },
});
