import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ShowMore } from "@/components/options/parts";
import { Badge, Card, Hint, Mono, Note, Tappable } from "@/components/ui";
import { countNew, countRemoved, filterScanEntries, scanDateLabel, type CatFilter, type Entry } from "@/lib/options/logic";
import type { ListingScan } from "@/lib/options/types";
import { fonts, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const CAP = 8;

function TickerLine({ entry, kind }: { entry: Entry; kind: "new" | "removed" }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const color = kind === "new" ? c.buy : c.sell;
  return (
    <Tappable onPress={() => router.push(`/ticker/${encodeURIComponent(entry[0])}`)} style={styles.line}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Mono bold style={{ fontSize: 14, color, minWidth: 54 }}>{entry[0]}</Mono>
      <Text style={styles.company} numberOfLines={1}>{entry[1]}</Text>
      <Badge label={kind === "new" ? "NEW" : "REMOVED"} color={color} />
    </Tappable>
  );
}

function Category({ label, entries, kind }: { label: string; entries: Entry[]; kind: "new" | "removed" }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  const list = open ? entries : entries.slice(0, CAP);
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.catLabel}>{label.toUpperCase()}  <Text style={{ fontFamily: fonts.mono }}>{kind === "new" ? "+" : "−"}{entries.length}</Text></Text>
      {list.map(([t, n]) => <TickerLine key={`${kind}-${t}`} entry={[t, n]} kind={kind} />)}
      <ShowMore total={entries.length} shown={CAP} open={open} onPress={() => setOpen((v) => !v)} />
    </View>
  );
}

/** One dated CBOE scan: the website's TimelineEntry. Removed entries sit behind a toggle unless a filter is on. */
export function ListingScanCard({ scan, category, search }: { scan: ListingScan; category: CatFilter; search: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [removedOpen, setRemovedOpen] = useState(false);
  const d = new Date(scan.date);
  const time = Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const f = filterScanEntries(scan, category, search);
  const filterActive = category !== "all" || search.trim() !== "";
  const nNew = countNew(f), nRemoved = countRemoved(f);

  if (!scan.hasChanges) {
    return (
      <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View><Text style={styles.date}>{scanDateLabel(scan.date)}</Text><Hint>{time}</Hint></View>
        <Hint>✓ stable — no changes</Hint>
      </Card>
    );
  }
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
        <View><Text style={styles.date}>{scanDateLabel(scan.date)}</Text><Hint>{time}</Hint></View>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {nNew > 0 && <Badge label={`+${nNew} new`} color={c.buy} />}
          {nRemoved > 0 && (
            <Pressable onPress={() => setRemovedOpen((v) => !v)} accessibilityRole="button" hitSlop={8}>
              <Badge label={`−${nRemoved} removed ${removedOpen || filterActive ? "▴" : "▾"}`} color={c.sell} />
            </Pressable>
          )}
        </View>
      </View>
      {scan.isInitial && <Note>First scan: this is the starting baseline of CBOE's list, not a day of new listings.</Note>}
      {nNew > 0 && (
        <View style={{ gap: spacing.md }}>
          <Category label="Newly optionable" entries={f.newOptionable} kind="new" />
          <Category label="Weekly ETFs" entries={f.newWeeklyEtfs} kind="new" />
          <Category label="Weekly equities" entries={f.newWeeklyEquities} kind="new" />
        </View>
      )}
      {nRemoved > 0 && (removedOpen || filterActive) && (
        <View style={{ gap: spacing.md, borderTopColor: c.border, borderTopWidth: 1, paddingTop: spacing.md }}>
          <Category label="Options removed" entries={f.removedOptionable} kind="removed" />
          <Category label="Weekly ETFs removed" entries={f.removedWeeklyEtfs} kind="removed" />
          <Category label="Weekly equities removed" entries={f.removedWeeklyEquities} kind="removed" />
        </View>
      )}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    date: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    catLabel: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, marginBottom: 2 },
    line: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderRadius: radii.sm },
    company: { flex: 1, color: c.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  });
