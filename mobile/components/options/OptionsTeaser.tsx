import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { Card, Hint, Tappable } from "@/components/ui";
import { useStats } from "@/lib/stats";
import { inFile } from "@/lib/when";
import { useOptionActivity, useOptionListings } from "@/lib/options/queries";
import { fonts, spacing } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** A one-card doorway into the Options screens (Today and Explore). Counts are shown only once they are real. */
export function OptionsTeaser() {
  const c = useTheme();
  const act = useOptionActivity("daily");
  const listings = useOptionListings();
  const stats = useStats();
  const n = act.data?.optionsActivity.length;
  const latest = listings.data?.latest;
  const newCount = latest
    ? Object.keys(latest.diff.optionable.new).length + Object.keys(latest.diff.weeklyEtfs.new).length + Object.keys(latest.diff.weeklyEquities.new).length
    : null;
  const bits = [
    n != null ? `${n.toLocaleString("en-US")} option ${n === 1 ? "contract" : "contracts"} changed ${inFile(stats.data?.asOfDate)}` : null,
    newCount != null ? `${newCount} new on CBOE's list` : null,
  ].filter(Boolean);
  return (
    <Tappable onPress={() => router.push("/options")}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Ionicons name="layers-outline" size={22} color={c.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 }}>Options</Text>
          <Hint>{bits.length ? bits.join(" · ") : "Activity, new listings, expiration schedule"}</Hint>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
      </Card>
    </Tappable>
  );
}
