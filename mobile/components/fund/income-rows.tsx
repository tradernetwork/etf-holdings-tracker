import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Badge, Card, Hint, Mono, ThinBar } from "@/components/ui";
import { formatCount, formatShares, formatUsd } from "@/lib/format";
import type { IncomePosition, OtherPosition, PositionLeg, PositionsSummary } from "@/lib/fundExtras";
import { formatExpiry, formatStrike, normalizeOptionType } from "@/lib/book";
import { COVERAGE_CLASS_LABEL, coverageClass, legMeta, noCoverageMessage, qtyNote, ROLE_LABEL, type Notice, type PosRow } from "@/lib/incomeBook";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** Reusable income-position rows (stock with expandable option legs, a single leg, expiry header). */

const money = (v: number | null | undefined): string => (v == null ? "—" : formatUsd(v));
const price = (v: number | null | undefined): string => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pctText = (v: number, digits = 2): string => `${v.toFixed(digits)}%`;

function coverageTone(pct: number, c: Palette): string {
  return pct >= 90 ? c.buy : pct > 0 ? c.isNew : c.sell;
}

export function CoverageBar({ pct }: { pct: number | null }) {
  const c = useTheme();
  if (pct == null) return <Hint>—</Hint>;
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Mono style={{ fontSize: 12 }}>{Math.round(pct)}%</Mono>
        <View style={{ width: 44 }}><ThinBar fraction={Math.min(1, pct / 100)} color={coverageTone(pct, c)} height={5} /></View>
      </View>
      <Hint>{COVERAGE_CLASS_LABEL[coverageClass(pct)]}</Hint>
    </View>
  );
}

export function UpsideText({ pct }: { pct: number | null }) {
  const c = useTheme();
  if (pct == null) return <Hint>—</Hint>;
  const color = pct < 0 ? c.sell : pct < 2 ? c.isNew : c.buy;
  return <Mono style={{ fontSize: 12, color }}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</Mono>;
}

function roleColor(role: PositionLeg["role"], c: Palette): string {
  return { "written-call": c.isNew, "written-put": c.accent, "long-call": c.buy, "long-put": c.buy, synthetic: c.textMuted }[role];
}

/** One option leg: "MSTR 10/16/26 152.5 C", role, signed contracts, price, value, % NAV, upside, DTE. */
export function LegRow({ leg, ticker, opened }: { leg: PositionLeg; ticker?: string; opened?: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const type = normalizeOptionType(leg.optionType) === "Put" ? "P" : "C";
  const title = `${ticker ? `${ticker} ` : ""}${formatExpiry(leg.expiry)} ${formatStrike(leg.strike)} ${type}`;
  return (
    <View style={[styles.leg, leg.expired && { opacity: 0.5 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Mono bold style={{ fontSize: 13 }}>{title}</Mono>
          <Text style={{ color: roleColor(leg.role, c), fontFamily: fonts.bodyMedium, fontSize: 11 }}>{ROLE_LABEL[leg.role]}</Text>
        </View>
        <Hint>{legMeta(leg, opened)}</Hint>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 13, color: leg.marketValue != null && leg.marketValue < 0 ? c.isNew : c.textPrimary }}>{money(leg.marketValue)}</Mono>
        <Hint>{formatShares(leg.contracts)} ct · {price(leg.price)} · {pctText(leg.weight)}</Hint>
      </View>
    </View>
  );
}

/** One stock with its legs tucked underneath (tap to expand). */
export function PositionCard({ r, opened, open, onToggle }: { r: PosRow; opened: Map<string, string>; open: boolean; onToggle: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const { p } = r;
  const note = qtyNote(p);
  const liveLegs = p.legs.filter((l) => !l.expired).length;
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.head}>
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={16} color={p.legs.length ? c.textMuted : "transparent"} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Pressable onPress={() => router.push(`/ticker/${encodeURIComponent(p.ticker)}`)} hitSlop={6} accessibilityRole="link">
              <Text style={styles.ticker}>{p.ticker}{p.syntheticShares !== 0 ? " *" : ""}</Text>
            </Pressable>
            {r.isNew ? <Badge label="NEW" color={c.isNew} /> : null}
          </View>
          <Hint>{note ?? p.name}{liveLegs > 0 ? ` · ${liveLegs} ${liveLegs === 1 ? "leg" : "legs"}` : ""}</Hint>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Mono bold style={{ fontSize: 14 }}>{money(p.exposureValue)}</Mono>
          <Hint>{pctText(r.navPct, 1)} NAV</Hint>
        </View>
      </Pressable>
      <View style={styles.stats}>
        <Stat label="Qty" value={formatCount(p.totalShares) + (p.totalShares < 0 ? " short" : "")} />
        <Stat label="Price" value={p.spotSuppressed ? "⚠ n/a" : price(p.price)} color={p.spotSuppressed ? c.isNew : undefined} />
        <Stat label="Δ today" value={r.sharesDelta == null ? "—" : formatShares(r.sharesDelta)} color={r.sharesDelta == null ? undefined : r.sharesDelta > 0 ? c.buy : c.sell} />
        <View style={styles.stat}><Hint>Covered</Hint><CoverageBar pct={p.coveragePct} /></View>
        <View style={styles.stat}><Hint>Upside</Hint><UpsideText pct={r.upside} /></View>
        <Stat label="DTE" value={r.dte == null ? "—" : String(Math.round(r.dte))} />
      </View>
      {open ? p.legs.map((l, i) => <LegRow key={i} leg={l} opened={opened.get(optionKeyOf(p.ticker, l))} />) : null}
    </View>
  );
}

import { optionKey } from "@/lib/book";
export const optionKeyOf = (ticker: string, l: PositionLeg): string => optionKey(ticker, l.optionType, l.strike, l.expiry);

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useStyles(makeStyles);
  const c = useTheme();
  return (
    <View style={styles.stat}>
      <Hint>{label}</Hint>
      <Mono style={{ fontSize: 12, color: color ?? c.textPrimary }}>{value}</Mono>
    </View>
  );
}

export function ExpiryHeader({ expiry, dte, count }: { expiry: string; dte: number | null; count: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.expHead}>
      <Text style={styles.expTitle}>{formatExpiry(expiry)}</Text>
      {dte != null ? <Hint>{Math.round(dte)} DTE</Hint> : null}
      <View style={{ flex: 1 }} />
      <Hint>{count} {count === 1 ? "leg" : "legs"}</Hint>
    </View>
  );
}

/** Covered / uncovered / synthetic composition + stock exposure + stat strip. */
export function IncomeSummary({ summary, legCount, topSector, shortBook, incomeLegVisible, archetype }: { summary: PositionsSummary; legCount: number; topSector: string | null; shortBook: boolean; incomeLegVisible?: boolean; archetype?: { label?: string; summary?: string } }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.title}>Positions</Text>
      {archetype?.label ? <Text style={styles.line}><Text style={{ color: c.textPrimary, fontFamily: fonts.bodyBold }}>{archetype.label}</Text>{archetype.summary ? `: ${archetype.summary}` : ""}</Text> : null}
      {summary.coveredPct != null ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: 2 }}>
            <Text style={styles.line}><Mono bold style={{ color: c.buy }}>{summary.coveredPct.toFixed(0)}%</Mono> covered</Text>
            <Text style={styles.line}><Mono bold style={{ color: c.sell }}>{summary.uncoveredPct?.toFixed(0) ?? "—"}%</Mono> uncovered</Text>
            {summary.syntheticPct ? <Text style={styles.line}><Mono bold>{summary.syntheticPct.toFixed(0)}%</Mono> held synthetically</Text> : null}
          </View>
          <View style={styles.split}>
            <View style={{ flex: Math.max(summary.coveredPct, 0.01), backgroundColor: c.buy }} />
            <View style={{ flex: Math.max(summary.uncoveredPct ?? 0, 0.01), backgroundColor: c.sell, opacity: 0.6 }} />
          </View>
          <Hint>
            Share of the {money(summary.stockExposureValue)} {shortBook ? "short " : ""}stock book that has calls written against it. Uncovered stock keeps all of its upside and pays no premium.
          </Hint>
        </>
      ) : (
        <Hint>{noCoverageMessage(incomeLegVisible)}</Hint>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: 2 }}>
        <Hint><Mono style={{ fontSize: 12 }}>{summary.stockPositions}</Mono> stocks</Hint>
        <Hint><Mono style={{ fontSize: 12 }}>{legCount}</Mono> live option legs</Hint>
        <Hint><Mono style={{ fontSize: 12 }}>{summary.otherPctNav.toFixed(0)}%</Mono> in T-bills &amp; cash</Hint>
        {topSector ? <Hint>Top sector <Text style={{ color: c.textSecondary }}>{topSector}</Text></Hint> : null}
      </View>
    </Card>
  );
}

/** Cash / Treasury / swap row (bucket totals come from /income's otherPositions). */
export function OtherPositionRow({ o }: { o: OtherPosition }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.head}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.ticker}>{o.label}</Text>
        <Hint>{o.lines} {o.lines === 1 ? "line" : "lines"}</Hint>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14 }}>{money(o.marketValue)}</Mono>
        <Hint>{pctText(o.weight, 1)} NAV</Hint>
      </View>
    </View>
  );
}

/** A data notice (invisible income leg, suppressed quote) shown as part of the page, not a footnote. */
export function NoticeCard({ n }: { n: Notice }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.notice, { borderColor: n.tone === "warn" ? c.warnBorder : c.border, backgroundColor: n.tone === "warn" ? c.warnBg : c.card }]}>
      <Ionicons name="eye-off-outline" size={20} color={c.warnText} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: c.warnText, fontFamily: fonts.bodyBold, fontSize: 14 }}>{n.title}</Text>
        <Text style={{ color: c.warnText, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>{n.body}</Text>
      </View>
    </View>
  );
}

export type { IncomePosition };

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { borderBottomColor: c.border, borderBottomWidth: 1 },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs, minHeight: MIN_TAP },
    ticker: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 17 },
    stats: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: 4, paddingLeft: spacing.xl, paddingBottom: spacing.sm },
    stat: { minWidth: 52, gap: 1 },
    leg: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingLeft: spacing.xl, borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth },
    expHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.xs, borderBottomColor: c.border, borderBottomWidth: 1 },
    expTitle: { ...display, color: c.textPrimary, fontSize: 18, letterSpacing: -0.4 },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
    line: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    notice: { flexDirection: "row", gap: spacing.md, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg },
    split: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: c.border },
  });
