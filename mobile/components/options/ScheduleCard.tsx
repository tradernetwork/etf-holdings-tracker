import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Chip, ShowMore } from "@/components/options/parts";
import { Badge, Card, Hint, Note, Mono } from "@/components/ui";
import { formatShortDate } from "@/lib/format";
import type { MwfSchedule } from "@/lib/options/types";
import { fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const HOLIDAYS_CAP = 4;

/** The "MWF Elite" box: today's status, the next expiration day, the 12 symbols; full mode adds holidays. */
export function ScheduleCard({ schedule, full }: { schedule: MwfSchedule; full?: boolean }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [holOpen, setHolOpen] = useState(false);
  const hol = full ? (holOpen ? schedule.holidays : schedule.holidays.slice(0, HOLIDAYS_CAP)) : [];
  return (
    <Card style={[{ gap: spacing.md }, schedule.isExpirationDay && { borderColor: c.isNew }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={[styles.flame, schedule.isExpirationDay && { backgroundColor: c.isNew + "26", borderColor: c.isNew }]}>
          <Ionicons name="flame" size={18} color={schedule.isExpirationDay ? c.isNew : c.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>MWF Elite expirations</Text>
          <Hint>Mon / Wed / Fri weekly options · excludes {schedule.excludes.join(" & ")}</Hint>
        </View>
        {schedule.isExpirationDay ? (
          <Badge label="0DTE TODAY" color={c.isNew} />
        ) : (
          <Badge label={`Next: ${schedule.nextExpirationDay}`} color={c.textSecondary} />
        )}
      </View>
      <Text style={styles.line}>
        Today is <Text style={styles.strong}>{schedule.dayName}</Text> ({formatShortDate(schedule.today)}, {schedule.timezone.replace("America/New_York", "New York time")}).
        {" "}{schedule.isExpirationDay ? "These symbols have options expiring today." : "No MWF expirations today."}
        {schedule.nextExpirationDate ? <Text> Next expiration: <Text style={styles.strong}>{schedule.nextExpirationDay}, {formatShortDate(schedule.nextExpirationDate)}</Text>.</Text> : null}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {schedule.tickers.map((t) => (
          <Chip key={t} label={t} color={schedule.isExpirationDay ? c.isNew : c.accent} on={schedule.isExpirationDay} onPress={() => router.push(`/ticker/${encodeURIComponent(t)}`)} />
        ))}
      </View>
      {full && (
        <View style={{ gap: 2, borderTopColor: c.border, borderTopWidth: 1, paddingTop: spacing.md }}>
          <Text style={styles.sub}>NYSE HOLIDAYS AHEAD (NO EXPIRATIONS)</Text>
          {schedule.holidays.length === 0 ? <Note>None listed.</Note> : null}
          {hol.map((h) => <Mono key={h} style={{ fontSize: 13, color: c.textSecondary }}>{formatShortDate(h)} · {h}</Mono>)}
          <ShowMore total={schedule.holidays.length} shown={HOLIDAYS_CAP} open={holOpen} onPress={() => setHolOpen((v) => !v)} />
        </View>
      )}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flame: { width: 38, height: 38, borderRadius: radii.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center" },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    line: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
    strong: { color: c.textPrimary, fontFamily: fonts.bodyBold },
    sub: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginBottom: 4 },
  });
