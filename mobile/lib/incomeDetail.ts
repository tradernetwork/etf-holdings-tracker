/**
 * /income/{fund} detail (website: app/income/[fund]/page.tsx): six coverage tiles, the sleeve bar and the
 * one-row-per-underlying book. Types and the pure display rules; the screen only lays them out.
 * Same endpoint as the fund screen's income tab (IncomeFundResponse), with the fields that tab doesn't read.
 */
import { dteToday } from "./expiry";
import type { IncomeFundResponse } from "./fundExtras";
import { pct, type IncomeSleeves, type IncomeTiles, type Tone } from "./incomeDirectory";

export interface IncomeBookRow {
  underlying: string;
  equity: { ticker: string; name: string; weight: number; shares: number; price: number | null } | null;
  spot: number | null;
  /** The fund's own mark and our quote feed disagree by more than 5%: derived numbers are hidden. */
  spotSuppressed: boolean;
  writtenCall: { optionType: string; strike: number; expiry: string; dte: number | null; contracts: number; weight: number; moneyness: number | null } | null;
  writtenCallCount: number;
  writtenPutCount: number;
  longLegs: { optionType: string; strike: number; expiry: string; dte: number | null; contracts: number }[];
  /** 0..1 */
  coveredFraction: number | null;
  upsideRoomPct: number | null;
  capped: boolean;
  optionWeight: number;
  legCount: number;
}
export type IncomeDetail = IncomeFundResponse & {
  aum?: number | null;
  netAssets?: number | null;
  sleeves: IncomeSleeves;
  tiles: IncomeTiles;
  counts: { equityPositions: number; optionLegs: number; underlyings: number };
  book: IncomeBookRow[];
};

/** The detail fields exist only on a server that serves them; the screen says so instead of faking tiles. */
export const hasIncomeDetail = (d: IncomeFundResponse | undefined): d is IncomeDetail => !!d && "tiles" in d && "book" in d && !!(d as IncomeDetail).tiles;

export const INVISIBLE_DETAIL_TITLE = "We can show you what this fund owns. We cannot show you what it sold.";
export const invisibleDetailBody = (fund: string): string =>
  `${fund} writes contracts that open and expire inside a single session. An end-of-day holdings file — which is all any fund publishes — structurally cannot contain one. Across every snapshot we hold, this fund has shown zero written options. That's the strategy working as designed, not a gap in our data. The long exposure below is real; the income leg is invisible to everyone, including us.`;

export interface TileView { label: string; value: string; sub: string; tone: Tone }

const signed = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;

/** The website's six tiles, in its order, with its tones and sub-lines. */
export function detailTiles(t: IncomeTiles): TileView[] {
  const m = t.weightedMoneynessPct;
  const dte = t.weightedDte;
  return [
    { label: "Call coverage", value: pct(t.callCoveragePct), sub: "of the equity sleeve has a call written on it", tone: "plain" },
    {
      label: "Wtd moneyness", value: pct(m, 2),
      sub: m === null ? "no spot price available" : m > 0 ? "written in the money — upside sold" : "written out of the money",
      tone: m === null ? "muted" : m > 0 ? "sell" : "buy",
    },
    { label: "Wtd DTE", value: dte === null ? "—" : `${dte.toFixed(1)}d`, sub: dte === null ? "" : dte < 3 ? "daily cycle" : dte < 10 ? "weekly cycle" : "monthly or longer", tone: "plain" },
    {
      label: "Upside room", value: t.upsideRoomPct === null ? "—" : signed(t.upsideRoomPct), sub: "to the average written strike",
      tone: t.upsideRoomPct === null ? "muted" : t.upsideRoomPct <= 0 ? "sell" : "plain",
    },
    { label: "Capped", value: `${t.cappedNames}/${t.namesWithWrittenCalls}`, sub: "names already above their strike", tone: t.cappedNames > 0 ? "sell" : "plain" },
    { label: "Collateral", value: pct(t.collateralPct), sub: "cash + Treasuries", tone: "plain" },
  ];
}

export interface SleeveSegment { key: string; label: string; value: number }
export interface SleeveBarView {
  /** Positive sleeves above the axis, each as a share of their own total. */
  positive: (SleeveSegment & { share: number })[];
  /** Written options are negative NAV: drawn on their own bar, never inside a 0-100% partition. */
  short: { value: number; share: number } | null;
}

export function sleeveBar(s: IncomeSleeves): SleeveBarView {
  const raw: SleeveSegment[] = [
    { key: "equity", label: "Equity", value: s.equity },
    { key: "treasury", label: "Treasuries", value: s.treasury },
    { key: "cash", label: "Cash", value: Math.max(0, s.cash) },
    { key: "swap", label: "Swap", value: s.swap },
    { key: "optionsLong", label: "Long options", value: s.optionsLong },
  ].filter((x) => x.value > 0.05);
  const total = raw.reduce((a, x) => a + x.value, 0) || 1;
  const short = Math.abs(s.optionsShort);
  return {
    positive: raw.map((x) => ({ ...x, share: x.value / total })),
    short: short > 0.05 ? { value: s.optionsShort, share: Math.min(1, short / total) } : null,
  };
}

export const notionalLine = (t: IncomeTiles): string | null =>
  t.callNotionalPctNav === null && t.putNotionalPctNav === null ? null : `Notional written: calls ${pct(t.callNotionalPctNav)} of NAV · puts ${pct(t.putNotionalPctNav)} of NAV`;

const num = (v: number | null | undefined, d = 2): string =>
  v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export interface BookRowView {
  underlying: string;
  nav: string;
  shares: string;
  spot: string;
  spotSuppressed: boolean;
  strike: string;
  capped: boolean;
  dte: string;
  room: string;
  roomTone: Tone;
  covered: string;
  longLegs: string;
  legCount: number;
}

/** One row of "The book". `asOf` shifts the file's DTE to today so an Oct 9 "0d" doesn't read as live on Oct 11. */
export function bookRowView(r: IncomeBookRow, asOf?: string | null, now?: Date): BookRowView {
  const wc = r.writtenCall;
  const left = wc ? (asOf ? dteToday(wc.dte, asOf, now) : wc.dte) : null;
  const dte = !wc || wc.dte == null ? "—" : left === null ? "exp" : `${Math.round(left)}d`;
  return {
    underlying: r.underlying,
    nav: r.equity ? `${r.equity.weight.toFixed(2)}%` : "no shares",
    shares: r.equity?.shares ? r.equity.shares.toLocaleString("en-US") : "—",
    spot: r.spotSuppressed ? "⚠" : num(r.spot),
    spotSuppressed: r.spotSuppressed,
    strike: wc ? num(wc.strike) : "—",
    capped: r.capped,
    dte,
    room: r.upsideRoomPct === null ? "—" : signed(r.upsideRoomPct),
    roomTone: r.upsideRoomPct === null ? "muted" : r.upsideRoomPct <= 0 ? "sell" : r.upsideRoomPct < 3 ? "income" : "buy",
    covered: r.coveredFraction === null ? "—" : `${(r.coveredFraction * 100).toFixed(0)}%`,
    longLegs: r.longLegs.length > 0 ? r.longLegs.map((l) => `${(l.optionType[0] ?? "").toUpperCase()}${l.strike}`).join(" ") : "—",
    legCount: r.legCount,
  };
}

export const ROOM_NOTE = "Room is (strike − spot) / spot — how far the stock can still run before the written call caps it. That's the holder's number. It is not the same as moneyness, which the fund quotes against the strike.";
export const COV_NOTE = "Cov is the share of the position covered by written calls, capped at 100%.";
export const SUPPRESSED_NOTE = "A ⚠ in the spot column means the fund's own mark and our quote feed disagree by more than 5%, so we suppress the derived numbers rather than show them wrong.";

export function netAssetsLabel(d: Pick<IncomeDetail, "netAssets">): string {
  return d.netAssets ? ` · $${(d.netAssets / 1e6).toFixed(1)}M net assets` : "";
}
