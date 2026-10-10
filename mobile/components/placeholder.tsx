import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "@/lib/theme";

export function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: spacing.lg },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: "800" },
  note: { color: colors.textSecondary, marginTop: spacing.sm, fontSize: 15 },
});
