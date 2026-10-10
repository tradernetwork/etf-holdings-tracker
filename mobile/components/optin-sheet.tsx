import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppState } from "@/lib/app-state";
import { fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles } from "@/lib/theme-context";

/**
 * One-time sheet shown right after the user's FIRST follow (never on launch,
 * never on web; see lib/notify.ts shouldPrompt). Enable asks for the OS
 * permission; Not now is final for the prompt (Settings stays available).
 */
export function OptInSheet() {
  const { promptVisible, enableNotifications, dismissPrompt } = useAppState();
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  return (
    <Modal visible={promptVisible} transparent animationType="slide" onRequestClose={dismissPrompt} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={dismissPrompt} accessibilityLabel="Not now" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Get a daily digest when funds move your follows?</Text>
        <Text style={styles.body}>
          One notification a day, only when a fund you follow (or a fund holding a stock you follow) made a meaningful move.
          Holdings are disclosed with a delay, so this is a digest, not a live alert. You can turn it off any time in Settings.
        </Text>
        <Pressable onPress={enableNotifications} accessibilityRole="button" style={styles.primary}>
          <Text style={styles.primaryText}>Enable</Text>
        </Pressable>
        <Pressable onPress={dismissPrompt} accessibilityRole="button" style={styles.secondary}>
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.overlay },
    sheet: {
      backgroundColor: c.card, borderTopLeftRadius: radii.card + 6, borderTopRightRadius: radii.card + 6,
      borderColor: c.border, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: spacing.lg, gap: spacing.md,
    },
    handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginTop: spacing.sm },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26, marginTop: spacing.sm },
    body: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
    primary: { minHeight: MIN_TAP + 4, borderRadius: radii.pill, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
    primaryText: { color: c.onAccent, fontFamily: fonts.bodyBold, fontSize: 15 },
    secondary: { minHeight: MIN_TAP, alignItems: "center", justifyContent: "center" },
    secondaryText: { color: c.textSecondary, fontFamily: fonts.bodyBold, fontSize: 14 },
  });
