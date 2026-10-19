import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Animated,
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
import { useLayout } from "@/lib/layout";
import { LOAD_ERROR_COPY, queryUiState, STALE_COPY, type QueryLike } from "@/lib/query-state";
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
  const { column } = useLayout();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: topInset ? insets.top + spacing.lg : spacing.xs,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xxl,
        gap: spacing.md,
        ...column,
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

/**
 * Fades the right edge of a horizontally scrolling row into the canvas, so a clipped chip reads as "more this way".
 * Pure JS (stacked translucent strips), no native gradient dependency. Pair the scroller with end padding.
 */
export function EdgeFade({ children, width = 28 }: { children: ReactNode; width?: number }) {
  const c = useTheme();
  const steps = 7;
  return (
    <View>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width, flexDirection: "row" }}>
        {Array.from({ length: steps }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: c.canvas, opacity: (i + 1) / steps }} />
        ))}
      </View>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return <Text style={styles.note}>{children}</Text>;
}

/** Pulsing placeholder bar. */
function SkeletonBar({ width, height = 12 }: { width: `${number}%` | number; height?: number }) {
  const c = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={{ width, height, borderRadius: radii.sm, backgroundColor: c.border, opacity: pulse }} />;
}

/** Loading placeholder: `rows` skeleton rows (default 4). Replaces the bare spinner and any "0 results" copy. */
export function Loading({ rows = 4 }: { rows?: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <SkeletonBar width={44} height={44} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <SkeletonBar width={i % 2 ? "55%" : "70%"} />
            <SkeletonBar width="40%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ErrorNote({ message = LOAD_ERROR_COPY, onRetry }: { message?: string; onRetry: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card>
      <Text style={styles.note}>{message}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
        <Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>Retry</Text>
      </Pressable>
    </Card>
  );
}

/** Failed refresh with cached data still showing. */
export function StaleNote({ onRetry }: { onRetry: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stale}>
      <Text style={[styles.note, { flex: 1, color: c.stale }]}>{STALE_COPY}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
        <Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>Retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * Drop-in status block for any react-query result: skeleton while loading, error card + Retry when
 * nothing is cached, "showing last loaded data" note when a refresh fails over cached data.
 * Render the data itself separately; it stays visible in the stale case.
 */
export function QueryStatus({
  q,
  rows,
  message,
  ignoreError,
}: {
  q: QueryLike & { refetch: () => unknown };
  rows?: number;
  message?: string;
  /** Suppress the error UI (e.g. a 404 the screen explains itself). */
  ignoreError?: boolean;
}) {
  const state = queryUiState(q);
  if (state === "loading") return <Loading rows={rows} />;
  if (ignoreError) return null;
  if (state === "error") return <ErrorNote message={message} onRetry={() => q.refetch()} />;
  if (state === "stale") return <StaleNote onRetry={() => q.refetch()} />;
  return null;
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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // `hovered` only exists on web (mouse); undefined on touch, so phones are unchanged.
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        { opacity: pressed ? 0.7 : hovered ? 0.85 : 1, minHeight: MIN_TAP },
        style,
      ]}
    >
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
    skelRow: {
      flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.card, borderColor: c.border,
      borderWidth: 1, borderRadius: radii.card, padding: spacing.md,
    },
    stale: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    retry: { minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start" },
  });
