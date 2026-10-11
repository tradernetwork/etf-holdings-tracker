import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { FilterSheet, OptionGroup } from "@/components/filter-sheet";
import { HoldingCard } from "@/components/holdings/HoldingCard";
import { Card, ErrorNote, Hint, Loading, Note, Screen } from "@/components/ui";
import { formatShortDate } from "@/lib/format";
import {
  catchUpGroups, csvScopeNote, csvUrl, DEFAULT_FILTERS, KIND_OPTIONS, loadsWhole, narrowKind, paginate, PAGE_SIZES, sortAllowed, sortDisabledNote, SORT_COLUMNS, sortRows, summaryLine,
  type HoldingsFilters, type HoldingsKind, type SortKey,
} from "@/lib/holdingsBrowser";
import { useHoldings } from "@/lib/holdingsQueries";
import { useFunds } from "@/lib/queries";
import { display, fonts, MIN_TAP, radii, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";

/** The website's /holdings: every raw position row across all funds, filtered, sorted on all 12 columns, paged, exportable. */
export default function HoldingsBrowser() {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [f, setF] = useState<HoldingsFilters>(DEFAULT_FILTERS);
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const funds = useFunds();

  // Debounce typing so each keystroke is not a request.
  useEffect(() => {
    if (text.trim() === f.q) return;
    const t = setTimeout(() => setF((p) => ({ ...p, q: text.trim(), page: 1 })), 350);
    return () => clearTimeout(t);
  }, [text, f.q]);

  // A sort only the phone could do falls away when the book is no longer small enough to load whole.
  useEffect(() => {
    const col = SORT_COLUMNS.find((x) => x.key === f.sort);
    if (col && !sortAllowed(col, f)) setF((p) => ({ ...p, sort: null }));
  }, [f]);

  const set = (patch: Partial<HoldingsFilters>, resetPage = true) => setF((p) => ({ ...p, ...patch, page: resetPage ? 1 : patch.page ?? p.page }));
  const q = useHoldings(f);
  const whole = loadsWhole(f);

  const view = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    if (whole) {
      const rows = sortRows(narrowKind(d.holdings, f.kind), f.sort, f.dir);
      const pg = paginate(rows, f.page, f.size);
      return { rows: pg.rows, total: rows.length, page: pg.page, pages: pg.pages };
    }
    return { rows: d.holdings, total: d.total, page: d.page ?? f.page, pages: d.pages ?? 1 };
  }, [q.data, whole, f.kind, f.sort, f.dir, f.page, f.size]);

  const fundList = (funds.data?.funds ?? []).map((x) => x.fund).sort();
  const groups = catchUpGroups(funds.data?.funds ?? []);
  const scope = csvScopeNote(f);

  return (
    <Screen topInset={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={styles.title}>Holdings</Text>
      <Hint>Every position row across all tracked funds, as the funds filed it: stocks, option legs, swaps, cash and Treasuries.</Hint>
      {groups.map((g) => (
        <Note key={g.since ?? "x"}>{g.funds.join(", ")}: catch-up{g.since ? ` since ${formatShortDate(g.since)}` : ""}. Their previous file was carried forward, so Δ columns show — instead of weeks of trades as one day.</Note>
      ))}

      <View style={styles.search}>
        <Ionicons name="search" size={18} color={c.textMuted} />
        <TextInput value={text} onChangeText={setText} placeholder="Search ticker or name" placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        {text.length > 0 && <Pressable onPress={() => setText("")} accessibilityLabel="Clear search" hitSlop={10}><Ionicons name="close-circle" size={18} color={c.textMuted} /></Pressable>}
      </View>

      <View style={styles.chips}>
        <Chip label={f.fund ? `Fund: ${f.fund}` : "All funds"} on={!!f.fund} onPress={() => setSheet(true)} />
        {KIND_OPTIONS.map((o) => <Chip key={o.value} label={o.label} on={f.kind === o.value} onPress={() => set({ kind: o.value as HoldingsKind })} />)}
      </View>

      <Text style={styles.small}>SORT</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
        {SORT_COLUMNS.map((col) => {
          const ok = sortAllowed(col, f);
          const on = f.sort === col.key;
          return (
            <Pressable
              key={col.key}
              onPress={() => {
                if (!ok) { setNote(sortDisabledNote); return; }
                setNote(null);
                set(on ? { dir: f.dir === "desc" ? "asc" : "desc" } : { sort: col.key as SortKey, dir: col.key === "fund" || col.key === "ticker" || col.key === "name" || col.key === "type" ? "asc" : "desc" });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: !ok }}
              style={[styles.chip, on && { backgroundColor: c.accent + "22", borderColor: c.accent }, !ok && { opacity: 0.45 }]}
            >
              <Text style={[styles.chipText, on && { color: c.accent }]}>{col.label}{on ? (f.dir === "desc" ? " ↓" : " ↑") : ""}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {note ? <Hint>{note}</Hint> : null}

      {q.isLoading && !q.data && <Loading />}
      {q.isError && <ErrorNote message="Couldn't load holdings. The API allows 30 requests a minute for this book." onRetry={() => q.refetch()} />}

      {view && (
        <>
          <View style={styles.summary}>
            <Text style={styles.summaryText}>{summaryLine(view.total, q.data?.asOfDate, whole)}</Text>
            <Pressable
              onPress={() => Linking.openURL(csvUrl(f))}
              onLongPress={() => Share.share({ message: csvUrl(f) })}
              accessibilityRole="button"
              accessibilityLabel="Export the filtered book as CSV"
              style={styles.export}
            >
              <Ionicons name="download-outline" size={16} color={c.accent} />
              <Text style={styles.exportText}>Export CSV</Text>
            </Pressable>
          </View>
          <Hint>The CSV is the full filtered result, not just this page. Long-press to share the link.{scope ? ` ${scope}` : ""}</Hint>
          {view.rows.length === 0 ? <Card><Note>No rows match. Try clearing the search or the type filter.</Note></Card> : <View>{view.rows.map((r, i) => <HoldingCard key={`${r.fund}|${r.ticker}|${i}`} r={r} />)}</View>}
          <Pager page={view.page} pages={view.pages} onPage={(p) => set({ page: p }, false)} size={f.size} onSize={(n) => set({ size: n })} />
        </>
      )}

      <FilterSheet visible={sheet} title="Fund" onClose={() => setSheet(false)} onReset={() => { set({ fund: "" }); setSheet(false); }} applyLabel="Done">
        <OptionGroup label="Fund" options={[{ value: "", label: "All funds" }, ...fundList.map((x) => ({ value: x, label: x }))]} value={f.fund} onChange={(v) => { set({ fund: v }); setSheet(false); }} />
      </FilterSheet>
    </Screen>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && { backgroundColor: c.accent + "22", borderColor: c.accent }]}>
      <Text style={[styles.chipText, on && { color: c.accent }]}>{label}</Text>
    </Pressable>
  );
}

function Pager({ page, pages, onPage, size, onSize }: { page: number; pages: number; onPage: (p: number) => void; size: number; onSize: (n: number) => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const Btn = ({ label, to, disabled }: { label: string; to: number; disabled: boolean }) => (
    <Pressable onPress={() => onPage(to)} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.pgBtn, disabled && { opacity: 0.35 }]}>
      <Text style={{ color: c.textPrimary, fontFamily: fonts.bodyBold }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.pager}>
        <Btn label="«" to={1} disabled={page <= 1} />
        <Btn label="‹" to={page - 1} disabled={page <= 1} />
        <Text style={styles.pageText}>Page {page.toLocaleString("en-US")} of {pages.toLocaleString("en-US")}</Text>
        <Btn label="›" to={page + 1} disabled={page >= pages} />
        <Btn label="»" to={pages} disabled={page >= pages} />
      </View>
      <View style={[styles.chips, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={styles.small}>ROWS PER PAGE</Text>
        {PAGE_SIZES.map((n) => <Chip key={n} label={String(n)} on={size === n} onPress={() => onSize(n)} />)}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { ...display, color: c.textPrimary, fontSize: 30 },
    search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: MIN_TAP, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md },
    input: { flex: 1, color: c.textPrimary, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0, minHeight: MIN_TAP },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    chip: { minHeight: MIN_TAP - 8, paddingHorizontal: 12, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
    chipText: { color: c.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 12 },
    small: { color: c.textMuted, fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1 },
    summary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
    summaryText: { color: c.textSecondary, fontFamily: fonts.mono, fontSize: 12, flex: 1 },
    export: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TAP, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: c.border, borderRadius: radii.pill, backgroundColor: c.card },
    exportText: { color: c.accent, fontFamily: fonts.bodyBold, fontSize: 13 },
    pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
    pgBtn: { minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border, borderRadius: radii.card, backgroundColor: c.card },
    pageText: { color: c.textSecondary, fontFamily: fonts.mono, fontSize: 12, minWidth: 120, textAlign: "center" },
  });
