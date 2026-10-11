import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ShowMore } from "@/components/options/parts";
import { OptionRow } from "@/components/fund/option-row";
import { Card, FreshnessLabel, Hint, Note, Tappable } from "@/components/ui";
import { formatExpiry } from "@/lib/book";
import { freshnessLabel } from "@/lib/format";
import { legToLine } from "@/lib/optionHolders";
import {
  legsOfStructure, STRUCTURE_BLURB, structureLabel, TRADE_BLURB, tradeSummary,
} from "@/lib/options/logic";
import type { FundOptionBook, OptionLeg, OptionStructure, OptionTrade } from "@/lib/options/types";
import { fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

const CAP = 3;

/** One contract, rendered by the shared option row so it reads the same as on the fund screen. */
export function LegLine({ leg, underlying }: { leg: OptionLeg; underlying: string }) {
  const moved = leg.prevContracts != null && leg.change != null && leg.change !== 0;
  return (
    <OptionRow
      plain
      showWeight={false}
      line={legToLine(leg, underlying)}
      note={moved ? `${Math.round(leg.prevContracts as number).toLocaleString("en-US")} → ${Math.round(leg.contracts).toLocaleString("en-US")}` : undefined}
    />
  );
}

function StructureBlock({ book, s, underlying }: { book: FundOptionBook; s: OptionStructure; underlying: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const legs = legsOfStructure(book, s);
  const size = Math.abs(Math.round(s.contracts)).toLocaleString("en-US");
  return (
    <View style={styles.block}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.blockHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.blockTitle}>{structureLabel(s)}</Text>
          <Hint>{size} {Math.abs(s.contracts) === 1 ? "contract" : "contracts"} · {legs.length} {legs.length === 1 ? "leg" : "legs"}</Hint>
        </View>
        <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 12 }}>{open ? "Hide legs ▴" : "Legs ▾"}</Text>
      </Pressable>
      {open && (
        <View style={{ gap: 2 }}>
          <Hint style={{ marginBottom: 4 }}>{STRUCTURE_BLURB[s.kind] ?? ""}</Hint>
          {legs.map((l, i) => <LegLine key={`${l.occ ?? i}-${i}`} leg={l} underlying={underlying} />)}
        </View>
      )}
    </View>
  );
}

function TradeBlock({ t, underlying }: { t: OptionTrade; underlying: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.block}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.blockHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.blockTitle}>{tradeSummary(t)}</Text>
          <Hint>{t.legs.length} {t.legs.length === 1 ? "leg" : "legs"} changed</Hint>
        </View>
        <Text style={{ color: c.accent, fontFamily: fonts.bodyBold, fontSize: 12 }}>{open ? "Hide legs ▴" : "Legs ▾"}</Text>
      </Pressable>
      {open && (
        <View style={{ gap: 2 }}>
          <Hint style={{ marginBottom: 4 }}>{TRADE_BLURB[t.kind] ?? ""}</Hint>
          {t.legs.map((l, i) => <LegLine key={`${l.occ ?? i}-${i}`} leg={l} underlying={underlying} />)}
        </View>
      )}
    </View>
  );
}

/** One fund's option book on one stock: what it holds now (grouped), what changed since the compare date, every leg drillable. */
export function FundOptionBookCard({ book, underlying, compact }: { book: FundOptionBook; underlying: string; compact?: boolean }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [allStructs, setAllStructs] = useState(false);
  const [allTrades, setAllTrades] = useState(false);
  const cap = compact ? 2 : CAP;
  const structs = allStructs ? book.structures : book.structures.slice(0, cap);
  const trades = allTrades ? book.trades : book.trades.slice(0, cap);
  const fresh = freshnessLabel({ stale: book.stale, date: book.fileDate });
  return (
    <Card style={{ gap: spacing.md }}>
      <Tappable onPress={() => router.push(`/fund/${encodeURIComponent(book.fund)}`)} style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.fund}>{book.fund}</Text>
          <Hint>{book.legs.length} {book.legs.length === 1 ? "leg" : "legs"}{book.pairedPct != null ? ` · ${Math.round(book.pairedPct)}% of traded legs paired` : ""}</Hint>
        </View>
        <FreshnessLabel freshness={fresh} />
        {book.refreshed === false && <Note>Today's issuer file was missing, so these are the last known legs carried forward.</Note>}
      </Tappable>

      <View style={{ gap: spacing.xs }}>
        <Text style={styles.sub}>HELD NOW · {book.structures.length} {book.structures.length === 1 ? "STRUCTURE" : "STRUCTURES"}</Text>
        {book.structures.length === 0 && <Note>No legs held.</Note>}
        {structs.map((s, i) => <StructureBlock key={`${s.kind}-${s.legs.join("_")}-${i}`} book={book} s={s} underlying={underlying} />)}
        <ShowMore total={book.structures.length} shown={cap} open={allStructs} onPress={() => setAllStructs((v) => !v)} />
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={styles.sub}>
          CHANGED{book.compareDate ? ` SINCE ${formatExpiry(book.compareDate)}` : ""} · {book.trades.length} {book.trades.length === 1 ? "TRADE" : "TRADES"}
        </Text>
        {book.trades.length === 0 && <Note>No contracts changed since {book.compareDate ? formatExpiry(book.compareDate) : "the previous file"}.</Note>}
        {trades.map((t, i) => <TradeBlock key={`${t.kind}-${i}`} t={t} underlying={underlying} />)}
        <ShowMore total={book.trades.length} shown={cap} open={allTrades} onPress={() => setAllTrades((v) => !v)} />
      </View>
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fund: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 18 },
    sub: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8 },
    block: { borderColor: c.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
    blockHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
    blockTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 14 },
  });
