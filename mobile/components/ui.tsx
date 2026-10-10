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
import { fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

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
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: topInset ? insets.top + spacing.lg : spacing.xs,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl,
        gap: spacing.md,
      }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(makeStyles);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

/** Small right-aligned caption used next to section titles and under values. */
export function Hint({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useTheme();
  return <Text style={[{ color: c.textMuted, fontFamily: fonts.body, fontSize: 11 }, style]}>{children}</Text>;
}

export function Mono({ children, style, bold }: { children: ReactNode; style?: StyleProp<TextStyle>; bold?: boolean }) {
  const c = useTheme();
  return <Text style={[{ fontFamily: bold ? fonts.monoBold : fonts.mono, color: c.textPrimary }, style]}>{children}</Text>;
}

/** Fund/ticker code in a rounded square, as in the Codex mockup. */
export function Monogram({ label }: { label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.monogram}>
      <Text style={styles.monogramText} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </View>
  );
}

export function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.tile}>
      <Mono bold style={{ fontSize: 20, color: color ?? c.textPrimary }}>{value}</Mono>
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
  const c = useTheme();
  const styles = useStyles(makeStyles);
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
            <Text style={[styles.segmentText, on && { color: c.textPrimary }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.badge, { backgroundColor: color + "26", borderColor: color + "66" }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

/** Thin 0..1 bar (conviction, weight). */
export function ThinBar({ fraction, color, height = 3 }: { fraction: number; color: string; height?: number }) {
  const c = useTheme();
  const w = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` as const;
  return (
    <View style={{ height, backgroundColor: c.border, borderRadius: height, overflow: "hidden" }}>
      <View style={{ width: w, height, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function FreshnessLabel({ freshness }: { freshness: Freshness }) {
  const c = useTheme();
  if (!freshness.text) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {freshness.stale && <Ionicons name="time-outline" size={12} color={c.stale} />}
      <Text style={{ color: c.stale, fontSize: 11, fontFamily: fonts.body }}>{freshness.text}</Text>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return <Text style={styles.note}>{children}</Text>;
}

export function Loading() {
  const c = useTheme();
  return <ActivityIndicator color={c.accent} style={{ marginVertical: spacing.xl }} />;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card>
      <Text style={styles.note}>{message}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
        <Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>Try again</Text>
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.canvas },
    card: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: radii.card,
      padding: spacing.lg,
      gap: spacing.md,
    },
    sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
    sectionTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
    monogram: {
      width: 44, height: 44, borderRadius: radii.md, alignItems: "center", justifyContent: "center",
      backgroundColor: c.canvas, borderColor: c.border, borderWidth: 1, paddingHorizontal: 4,
    },
    monogramText: { color: c.textSecondary, fontFamily: fonts.monoBold, fontSize: 11 },
    tile: {
      flex: 1, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.card,
      paddingVertical: spacing.md, alignItems: "center", gap: 2,
    },
    tileLabel: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 0.8 },
    segmented: {
      flexDirection: "row", backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, padding: 3,
    },
    segment: { flex: 1, minHeight: MIN_TAP - 6, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.sm },
    segmentOn: { backgroundColor: c.border },
    segmentText: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 13 },
    badge: { borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 6, paddingVertical: 1 },
    badgeText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.6 },
    note: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
    retry: { minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start" },
  });
