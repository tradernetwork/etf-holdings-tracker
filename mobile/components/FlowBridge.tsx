import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Hint } from "@/components/ui";
import { tmHref, TM_GOLD } from "@/lib/tm";
import { fonts, MIN_TAP, radii, spacing } from "@/lib/theme";
import { useStyles } from "@/lib/theme-context";
import type { Palette } from "@/lib/theme";

/** Only TraderMatrix live options tape is teased here, using decorative bars.
 *  Our holdings, quantities and institutional allocation changes stay visible. */
export function FlowBridge({ ticker }: { ticker: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Did the options tape agree?</Text>
      <View style={styles.locked} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.bar, { width: "34%" }]} />
        <View style={[styles.bar, { width: "22%" }]} />
        <Ionicons name="lock-closed" size={14} color={TM_GOLD} style={{ marginLeft: "auto" }} />
      </View>
      <Pressable
        onPress={() => Linking.openURL(tmHref(ticker))}
        accessibilityRole="link"
        accessibilityLabel={`See ${ticker} flow on TraderMatrix`}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>See {ticker} flow on TraderMatrix →</Text>
      </Pressable>
      <Hint>Flow details live on TraderMatrix. Referral link disclosed.</Hint>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { borderColor: TM_GOLD + "55", borderWidth: 1, borderRadius: radii.card, backgroundColor: TM_GOLD + "0D", padding: spacing.md, gap: spacing.sm },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    locked: { flexDirection: "row", alignItems: "center", gap: spacing.sm, opacity: 0.7 },
    bar: { height: 14, borderRadius: 7, backgroundColor: TM_GOLD + "40" },
    cta: { minHeight: MIN_TAP, borderRadius: radii.pill, backgroundColor: TM_GOLD, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
    ctaText: { color: "#080D18", fontFamily: fonts.bodyBold, fontSize: 14 },
  });
