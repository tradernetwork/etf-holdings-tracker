import { StyleSheet, Text, View } from "react-native";
import { Badge, Hint, Mono } from "@/components/ui";
import { optionSubtitle, optionTitle, sideLabel, valueText, type OptionLine } from "@/lib/book";
import { expiryInfo, expirySubtitle } from "@/lib/expiry";
import { formatShares, formatWeight } from "@/lib/format";
import { deltaColor, fonts, MIN_TAP, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/**
 * The one option-leg row: title, expiry · DTE · FLEX, SHORT/LONG badge with contracts, ITM/OTM chip,
 * est. value, % of fund and contracts change. Used by the fund book, the ticker's option holders and
 * the option-structure legs so a contract reads identically everywhere.
 */
export function OptionRow({ line, showWeight = true, note, plain }: {
  line: OptionLine;
  /** False where the leg has no fund weight (option-structure legs). */
  showWeight?: boolean;
  /** Extra muted line under the change (e.g. "900 → 0"). */
  note?: string;
  /** Compact variant for nesting inside a card: hairline top border instead of the list divider. */
  plain?: boolean;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const dc = line.contractsDelta;
  const exp = expiryInfo({ expiry: line.expiry, asOf: line.asOf, fileDte: line.dte });
  const subtitle = line.asOf ? expirySubtitle(exp, line.expiry, line.flex) : optionSubtitle(line.expiry, line.dte, line.flex);
  return (
    <View style={[styles.row, plain && styles.plain, exp.expired && { opacity: 0.6 }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.title}>{optionTitle(line.underlying, line.type, line.strike)}</Text>
        <Hint style={exp.expired ? { color: c.textMuted, fontStyle: "italic" } : undefined}>{subtitle}</Hint>
        {exp.fileNote ? <Hint style={{ opacity: 0.8 }}>{exp.fileNote}</Hint> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Badge label={line.short ? "SHORT" : "LONG"} color={line.short ? c.isNew : c.accent} />
          <Hint>{sideLabel(line.contracts).replace(/^(Long|Short) · /, "")}</Hint>
          {line.chip ? <Badge label={line.chip.label} color={line.chip.label === "ITM" ? c.buy : c.textMuted} /> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono bold style={{ fontSize: 14, color: line.value.usd !== null && line.value.usd < 0 ? c.isNew : c.textPrimary }}>{valueText(line.value)}</Mono>
        {showWeight ? <Hint>{formatWeight(line.weight)} of fund</Hint> : null}
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: dc === null || dc === 0 ? c.textMuted : deltaColor(dc, c) }}>
          {dc === null ? "—" : dc === 0 ? "no change" : `${formatShares(dc)} ct`}
        </Text>
        {note ? <Hint>{note}</Hint> : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomColor: c.border, borderBottomWidth: 1, minHeight: MIN_TAP + 10 },
    plain: { paddingVertical: spacing.sm, borderBottomWidth: 0, borderTopColor: c.border, borderTopWidth: 1, minHeight: 0 },
    title: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
  });
