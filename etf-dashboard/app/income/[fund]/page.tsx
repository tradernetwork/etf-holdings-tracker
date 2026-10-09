import { api } from '@/lib/api';
import type { ApiIncomeBookRow, ApiIncomeFund } from '@/lib/api';
import { SiteNav } from '@/components/site-nav';
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/data-table';
import { Coins, EyeOff, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';


// ISR — see app/income/page.tsx for why this is 120 and not 600.
export const revalidate = 120;

const ACCENT = 'var(--income)';

function formatAsOfDate(asOf: string): string {
    return new Date(`${asOf}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
}

function pct(v: number | null | undefined, d = 1): string {
    return v === null || v === undefined ? '—' : `${v.toFixed(d)}%`;
}
function num(v: number | null | undefined, d = 2): string {
    return v === null || v === undefined ? '—' : v.toLocaleString(undefined, {
        minimumFractionDigits: d, maximumFractionDigits: d,
    });
}

function Tile({ label, value, sub, tone }: {
    label: string; value: string; sub?: string; tone?: string;
}) {
    return (
        <div className="bg-surface-alt border border-rule rounded-lg px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{label}</div>
            <div className={`text-xl font-black tabular-nums ${tone ?? 'text-white'}`}>{value}</div>
            {sub && <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{sub}</div>}
        </div>
    );
}

/**
 * The sleeve bar. Short options carry NEGATIVE weight, so they render below the
 * axis — a stacked bar that pretends the book is a 0-100% partition would be
 * lying about a fund whose short options are -35% of NAV.
 */
function SleeveBar({ sleeves }: { sleeves: ApiIncomeFund['sleeves'] }) {
    const positive: [string, number, string][] = [
        ['Equity', sleeves.equity, 'var(--equity)'],
        ['Treasuries', sleeves.treasury, '#818cf8'],
        ['Cash', Math.max(0, sleeves.cash), '#64748b'],
        ['Swap', sleeves.swap, 'var(--meta)'],
        ['Long options', sleeves.optionsLong, 'var(--buy)'],
    ].filter(([, v]) => (v as number) > 0.05) as [string, number, string][];

    const posTotal = positive.reduce((s, [, v]) => s + v, 0) || 1;
    const short = Math.abs(sleeves.optionsShort);
    const shortWidth = Math.min(100, (short / posTotal) * 100);

    return (
        <div className="space-y-2">
            <div className="flex h-6 rounded-md overflow-hidden border border-rule">
                {positive.map(([label, v, color]) => (
                    <div
                        key={label}
                        title={`${label}: ${v.toFixed(1)}% of NAV`}
                        style={{ width: `${(v / posTotal) * 100}%`, backgroundColor: color }}
                        className="h-full"
                    />
                ))}
            </div>
            {short > 0.05 && (
                <div className="flex h-3 rounded-md overflow-hidden">
                    <div
                        title={`Short options: ${sleeves.optionsShort.toFixed(2)}% of NAV`}
                        style={{ width: `${shortWidth}%`, backgroundColor: 'var(--sell)' }}
                        className="h-full rounded-md"
                    />
                </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-400">
                {positive.map(([label, v, color]) => (
                    <span key={label} className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
                        {label} {v.toFixed(1)}%
                    </span>
                ))}
                {short > 0.05 && (
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-sm bg-sell" />
                        Short options {sleeves.optionsShort.toFixed(2)}%
                    </span>
                )}
            </div>
        </div>
    );
}

const bookColumns: DataTableColumn[] = [
    { key: 'underlying', header: 'Name' },
    { key: 'navPct', header: '% NAV', align: 'right' },
    { key: 'shares', header: 'Shares', align: 'right', mobilePriority: 'sm' },
    { key: 'spot', header: 'Spot', align: 'right' },
    { key: 'strike', header: 'Strike', align: 'right' },
    { key: 'dte', header: 'DTE', align: 'right' },
    { key: 'room', header: 'Room', align: 'right' },
    { key: 'covered', header: 'Cov', align: 'right', mobilePriority: 'md' },
    { key: 'longLegs', header: 'Long legs', align: 'right', mobilePriority: 'lg' },
];

function bookRows(book: ApiIncomeBookRow[]): DataTableRow[] {
    return book.map((r) => {
        const roomTone = r.upsideRoomPct === null ? 'text-slate-500'
            : r.upsideRoomPct <= 0 ? 'text-sell'
                : r.upsideRoomPct < 3 ? 'text-income' : 'text-buy';
        return {
            key: r.underlying,
            cells: {
                underlying: (
                    <Link href={`/stocks/${r.underlying}`} className="font-mono text-xs font-bold text-white hover:text-income">
                        {r.underlying}
                    </Link>
                ),
                navPct: (
                    <span className="font-mono text-xs text-slate-300 tabular-nums">
                        {r.equity ? `${r.equity.weight.toFixed(2)}%` : <span className="text-slate-600">no shares</span>}
                    </span>
                ),
                shares: <span className="font-mono text-xs text-slate-400 tabular-nums">{r.equity?.shares ? r.equity.shares.toLocaleString() : '—'}</span>,
                spot: (
                    <span className="font-mono text-xs text-slate-300 tabular-nums">
                        {r.spotSuppressed
                            ? <span title="The fund's own mark and our quote feed disagree by more than 5% — moneyness suppressed rather than shown wrong."
                                className="text-income">⚠</span>
                            : num(r.spot)}
                    </span>
                ),
                strike: (
                    <span className="font-mono text-xs tabular-nums">
                        {r.writtenCall ? (
                            <span className={r.capped ? 'text-sell font-bold' : 'text-white'}>
                                {num(r.writtenCall.strike)}
                            </span>
                        ) : <span className="text-slate-600">—</span>}
                    </span>
                ),
                dte: (
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                        {r.writtenCall?.dte === null || r.writtenCall?.dte === undefined ? '—' : `${r.writtenCall.dte.toFixed(0)}d`}
                    </span>
                ),
                room: (
                    <span className={`font-mono text-xs tabular-nums font-semibold ${roomTone}`}>
                        {r.upsideRoomPct === null ? '—' : `${r.upsideRoomPct > 0 ? '+' : ''}${r.upsideRoomPct.toFixed(1)}%`}
                    </span>
                ),
                covered: <span className="font-mono text-[11px] text-slate-400 tabular-nums">{r.coveredFraction === null ? '—' : `${(r.coveredFraction * 100).toFixed(0)}%`}</span>,
                longLegs: <span className="font-mono text-[11px] text-slate-500 tabular-nums">{r.longLegs.length > 0 ? r.longLegs.map(l => `${l.optionType[0]}${l.strike}`).join(' ') : '—'}</span>,
            },
        };
    });
}

export default async function IncomeFundPage({ params }: { params: Promise<{ fund: string }> }) {
    const { fund } = await params;
    const detail = await api.incomeFund(fund);
    if (!detail) notFound();

    const t = detail.tiles;
    const s = detail.sleeves;

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-4 sm:p-6 space-y-4 font-sans">
            <SiteNav world="option-income" />

            {/* ── Header: what kind of fund is this ───────────────────────── */}
            <div className="bg-surface border border-rule rounded-xl p-4">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                        <Coins className="h-6 w-6" style={{ color: ACCENT }} />
                        <span style={{ color: ACCENT }}>{detail.fund}</span>
                        <span className="text-sm font-normal text-slate-400">{detail.provider}</span>
                    </h1>
                    {/* Net assets comes straight from the snapshot's own
                        NetAssets column. detail.aum (api/data.py's
                        get_fund_aum) now derives from the same snapshot when
                        NetAssets is present, but still falls back to the
                        hand-maintained static FUND_AUM table for funds that
                        don't carry the column — so it isn't shown here to
                        avoid ever surfacing that stale fallback next to the
                        real figure. */}
                    <div className="text-xs font-mono text-slate-500">
                        {formatAsOfDate(detail.asOfDate)}
                        {detail.netAssets
                            ? ` · $${(detail.netAssets / 1e6).toFixed(1)}M net assets`
                            : ''}
                    </div>
                </div>
                <div className="mt-2 border-l-2 pl-3" style={{ borderColor: ACCENT }}>
                    <div className="text-sm font-bold text-white">{detail.archetypeLabel}</div>
                    <p className="text-xs text-slate-400 mt-0.5 max-w-3xl leading-relaxed">
                        {detail.archetypeSummary}
                    </p>
                </div>
            </div>

            {/* ── The disclosure that makes the page honest ───────────────── */}
            {!detail.incomeLegVisible && (
                <div className="bg-surface border border-income/30 rounded-xl p-4 flex items-start gap-3">
                    <EyeOff className="h-5 w-5 shrink-0 mt-0.5" style={{ color: ACCENT }} />
                    <div>
                        <div className="text-sm font-bold" style={{ color: ACCENT }}>
                            We can show you what this fund owns. We cannot show you what it sold.
                        </div>
                        <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
                            {detail.fund} writes contracts that open and expire inside a single
                            session. An end-of-day holdings file — which is all any fund publishes —
                            structurally cannot contain one. Across every snapshot we hold, this fund
                            has shown zero written options. That&apos;s the strategy working as
                            designed, not a gap in our data. The long exposure below is real; the
                            income leg is invisible to everyone, including us.
                        </p>
                    </div>
                </div>
            )}

            {/* ── Six coverage tiles ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <Tile
                    label="Call coverage"
                    value={pct(t.callCoveragePct)}
                    sub="of the equity sleeve has a call written on it"
                />
                <Tile
                    label="Wtd moneyness"
                    value={pct(t.weightedMoneynessPct, 2)}
                    sub={t.weightedMoneynessPct === null ? 'no spot price available'
                        : t.weightedMoneynessPct > 0 ? 'written in the money — upside sold'
                            : 'written out of the money'}
                    tone={t.weightedMoneynessPct === null ? 'text-slate-500'
                        : t.weightedMoneynessPct > 0 ? 'text-sell' : 'text-buy'}
                />
                <Tile
                    label="Wtd DTE"
                    value={t.weightedDte === null ? '—' : `${t.weightedDte.toFixed(1)}d`}
                    sub={t.weightedDte === null ? '' : t.weightedDte < 3 ? 'daily cycle'
                        : t.weightedDte < 10 ? 'weekly cycle' : 'monthly or longer'}
                />
                <Tile
                    label="Upside room"
                    value={t.upsideRoomPct === null ? '—' : `${t.upsideRoomPct > 0 ? '+' : ''}${t.upsideRoomPct.toFixed(1)}%`}
                    sub="to the average written strike"
                    tone={t.upsideRoomPct === null ? 'text-slate-500'
                        : t.upsideRoomPct <= 0 ? 'text-sell' : 'text-white'}
                />
                <Tile
                    label="Capped"
                    value={`${t.cappedNames}/${t.namesWithWrittenCalls}`}
                    sub="names already above their strike"
                    tone={t.cappedNames > 0 ? 'text-sell' : 'text-white'}
                />
                <Tile
                    label="Collateral"
                    value={pct(t.collateralPct)}
                    sub="cash + Treasuries"
                />
            </div>

            {/* ── Sleeve composition ──────────────────────────────────────── */}
            <div className="bg-surface border border-rule rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-bold text-white">What backs the fund</h2>
                <SleeveBar sleeves={s} />
                {(t.callNotionalPctNav !== null || t.putNotionalPctNav !== null) && (
                    <p className="text-[11px] text-slate-500 font-mono">
                        Notional written: calls {pct(t.callNotionalPctNav)} of NAV
                        {' · '}puts {pct(t.putNotionalPctNav)} of NAV
                    </p>
                )}
            </div>

            {/* ── The book: one row per underlying ────────────────────────── */}
            <div className="bg-surface border border-rule rounded-xl overflow-hidden">
                <div className="p-4 pb-2 flex items-baseline justify-between gap-3 flex-wrap">
                    <h2 className="text-sm font-bold text-white">The book</h2>
                    <span className="text-[11px] font-mono text-slate-500">
                        {detail.book.length} underlying{detail.book.length === 1 ? '' : 's'} ·
                        {' '}{detail.counts.optionLegs} contracts collapsed to one row each
                    </span>
                </div>
                <DataTable
                    columns={bookColumns}
                    rows={bookRows(detail.book)}
                    emptyMessage="No option positions."
                    wrapperClassName="rounded-none border-0"
                    className="border-0"
                />
                <div className="px-4 py-3 border-t border-rule text-[11px] text-slate-500 leading-relaxed space-y-1">
                    <p>
                        <span className="text-slate-400 font-semibold">Room</span> is (strike − spot) / spot —
                        how far the stock can still run before the written call caps it. That&apos;s
                        the holder&apos;s number. It is not the same as moneyness, which the fund
                        quotes against the strike.
                    </p>
                    <p>
                        <span className="text-slate-400 font-semibold">Cov</span> is the share of the
                        position covered by written calls, capped at 100%.
                        {detail.book.some(r => r.spotSuppressed) && (
                            <> A <span className="text-income">⚠</span> in the spot column means the
                                fund&apos;s own mark and our quote feed disagree by more than 5%, so we
                                suppress the derived numbers rather than show them wrong.</>
                        )}
                    </p>
                </div>
            </div>

            {detail.book.length === 0 && (
                <div className="bg-surface border border-rule rounded-xl p-8 text-center">
                    <AlertTriangle className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">
                        No option positions in the latest snapshot for {detail.fund}.
                    </p>
                </div>
            )}

            <div className="flex gap-3 text-xs">
                <Link href="/income" className="text-slate-400 hover:text-income">← All Premium Sellers</Link>
                <Link href={`/fund/${detail.fund}`} className="text-slate-400 hover:text-income">
                    Full fund profile →
                </Link>
            </div>
        </div>
    );
}
