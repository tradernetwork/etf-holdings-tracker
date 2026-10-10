import { Ionicons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/**
 * Bottom sheet built on React Native's Modal. Chosen over @gorhom/bottom-sheet
 * on purpose: that library needs react-native-reanimated + gesture-handler
 * native modules (and extra web setup), and a filter picker needs none of its
 * drag physics. Modal behaves the same on Android, iOS and the web export, and
 * handles the Android back button via onRequestClose.
 */
export function FilterSheet({
  visible,
  title,
  onClose,
  onReset,
  applyLabel,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onReset: () => void;
  applyLabel: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onReset} accessibilityRole="button" style={styles.reset}>
            <Text style={{ color: c.accent, fontFamily: fonts.bodyBold }}>Reset</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.md }}>
          {children}
        </ScrollView>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.apply}>
          <Text style={styles.applyText}>{applyLabel}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={styles.groupLabel}>{label.toUpperCase()}</Text>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={styles.option}
          >
            <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? c.accent : c.textMuted} />
            <Text style={[styles.optionText, on && { color: c.textPrimary }]}>{o.label}</Text>
            {o.hint ? <Text style={styles.optionHint}>{o.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: radii.card + 6,
    borderTopRightRadius: radii.card + 6,
    borderColor: c.border,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.lg,
    maxHeight: "80%",
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginTop: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: spacing.sm },
  title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18 },
  reset: { minHeight: MIN_TAP, justifyContent: "center", paddingLeft: spacing.md },
  groupLabel: { color: c.textMuted, fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 0.8 },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: MIN_TAP },
  optionText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 15, flex: 1 },
  optionHint: { color: c.textMuted, fontFamily: fonts.body, fontSize: 12 },
  apply: { minHeight: MIN_TAP + 4, borderRadius: radii.pill, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  applyText: { color: c.onAccent, fontFamily: fonts.bodyBold, fontSize: 15 },
  });
