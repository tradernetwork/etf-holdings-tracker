import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Card, FreshnessLabel, Hint, Loading, Mono, Note, Screen, SectionHeader, Tappable } from "@/components/ui";
import { useAppState } from "@/lib/app-state";
import { fundFollowMoves, tickerFollowMoves, type FollowMove } from "@/lib/derive";
import { type Follow } from "@/lib/follows";
import { formatPp, formatShortDate, freshnessLabel } from "@/lib/format";
import { optInStatus } from "@/lib/notify";
import { useFund, useTicker } from "@/lib/queries";
import { deltaColor, display, fonts, spacing, type Palette } from "@/lib/theme";
import { useStyles, useTheme } from "@/lib/theme-context";
import { Platform } from "react-native";

const SUGGESTIONS: Follow[] = [
  { kind: "ticker", symbol: "AAPL" },
  { kind: "fund", symbol: "ARKK" },
];

export default function Following() {
  const styles = useStyles(makeStyles);
  const { follows, hydrated, notify } = useAppState();

  return (
    <Screen>
      <Text style={styles.title}>Following</Text>
      {!hydrated ? (
        <Loading />
      ) : follows.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>Nothing followed yet</Text>
          <Note>
            Follow a stock or a fund and this tab shows what its funds did today, only when the move is meaningful.
            Tap Follow on any ticker or fund screen.
          </Note>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
            {SUGGESTIONS.map((s) => (
              <Tappable key={s.symbol} onPress={() => router.push(s.kind === "fund" ? `/fund/${s.symbol}` : `/ticker/${s.symbol}`)} style={styles.suggest}>
                <Mono bold style={{ fontSize: 13 }}>{s.symbol}</Mono>
                <Hint>{s.kind === "fund" ? "fund" : "stock"}</Hint>
              </Tappable>
            ))}
          </View>
        </Card>
      ) : (
        <>
          <SectionHeader title={`${follows.length} followed`} right={<Hint>significant moves only</Hint>} />
          {follows.map((f) => (f.kind === "ticker" ? <TickerFollow key={`t-${f.symbol}`} symbol={f.symbol} /> : <FundFollow key={`f-${f.symbol}`} symbol={f.symbol} />))}
        </>
      )}
      {Platform.OS !== "web" && hydrated && <Hint style={{ marginTop: spacing.md }}>{optInStatus(notify)}</Hint>}
    </Screen>
  );
}

function MoveLines({ moves, more, kind, symbol }: { moves: FollowMove[]; more: number; kind: "ticker" | "fund"; symbol: string }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: 4 }}>
      {moves.map((m) => (
        <View key={m.who + m.verb} style={styles.moveRow}>
          <Text style={styles.moveText}>
            <Text style={{ fontFamily: fonts.monoBold, color: c.textPrimary }}>{m.who}</Text> {m.verb}{kind === "ticker" ? ` ${symbol}` : ""}
          </Text>
          <Mono style={{ fontSize: 13, color: deltaColor(m.delta, c) }}>{formatPp(m.delta)}</Mono>
        </View>
      ))}
      {more > 0 && <Hint>+{more} more significant {more === 1 ? "move" : "moves"}</Hint>}
    </View>
  );
}

function Shell({ symbol, kind, children, right }: { symbol: string; kind: "ticker" | "fund"; children: React.ReactNode; right?: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <Tappable onPress={() => router.push(kind === "fund" ? `/fund/${encodeURIComponent(symbol)}` : `/ticker/${encodeURIComponent(symbol)}`)}>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={styles.symbol}>{symbol}</Text>
            <Badge label={kind === "fund" ? "FUND" : "STOCK"} color={kind === "fund" ? "#7A86A8" : "#4C8DFF"} />
          </View>
          {right}
        </View>
        {children}
      </Card>
    </Tappable>
  );
}

function TickerFollow({ symbol }: { symbol: string }) {
  const q = useTicker(symbol);
  const { moves, more } = q.data ? tickerFollowMoves(q.data.changes) : { moves: [], more: 0 };
  return (
    <Shell symbol={symbol} kind="ticker">
      {q.isLoading ? <Loading /> : q.isError ? <Note>Couldn&apos;t load {symbol} right now.</Note> : moves.length > 0 ? <MoveLines moves={moves} more={more} kind="ticker" symbol={symbol} /> : <Note>Nothing meaningful today.</Note>}
    </Shell>
  );
}

function FundFollow({ symbol }: { symbol: string }) {
  const q = useFund(symbol);
  const f = q.data;
  const fresh = f ? freshnessLabel({ stale: f.stale, date: f.holdingsDate }) : null;
  const catchUp = f?.catchUpSince;
  const { moves, more } = f && !f.stale && !catchUp ? fundFollowMoves(f.recentChanges, f.fund) : { moves: [], more: 0 };
  return (
    <Shell symbol={symbol} kind="fund" right={fresh ? <FreshnessLabel freshness={fresh} /> : undefined}>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !f ? (
        <Note>Couldn&apos;t load {symbol} right now.</Note>
      ) : catchUp ? (
        <Note>Catch-up since {formatShortDate(catchUp)}: this isn&apos;t a one-day change, so no moves are shown.</Note>
      ) : f.stale ? (
        <Note>Older disclosure · {formatShortDate(f.holdingsDate)}. Quiet data is not proof of no trades.</Note>
      ) : moves.length > 0 ? (
        <MoveLines moves={moves} more={more} kind="fund" symbol={symbol} />
      ) : (
        <Note>Nothing meaningful today.</Note>
      )}
    </Shell>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    title: { ...display, color: c.textPrimary, fontSize: 30 },
    emptyTitle: { color: c.textPrimary, fontFamily: fonts.bodyBold, fontSize: 16 },
    suggest: { flexDirection: "row", alignItems: "center", gap: 6, borderColor: c.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, backgroundColor: c.canvas },
    symbol: { ...display, color: c.textPrimary, fontSize: 24, letterSpacing: -0.8 },
    moveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 24 },
    moveText: { color: c.textSecondary, fontFamily: fonts.body, fontSize: 14 },
  });
