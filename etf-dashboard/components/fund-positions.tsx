// Brokerage-style positions view for option-income funds.
//
// One row per stock, the option legs tucked underneath, and a covered /
// uncovered split — the shape every brokerage positions tab uses. The rest of
// the fund page is organised around the option contracts; this answers the
// question a holder actually asks first: "how much of this fund's stock has a
// call written on it?"
//
// Stock counts whether it is held outright or synthetically (long call +
// short put at the same strike). KQQQ, GDXY and the YieldMax single-name funds
// hold their underlying that way; counting only real shares would call MSTY
// 0% covered when every one of its written calls sits on synthetic stock.
//
// Pure server component — rows expand with native <details>, no client JS.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiIncomeFund, ApiPosition, ApiPositionLeg } from '@/lib/api';
import { ChevronRight, Wallet } from 'lucide-react';
import Link from 'next/link';

function fmtMoney(v: number | null | undefined): string {
    if (v == null) return '—';
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
    return `${sign}$${a.toFixed(0)}`;
}

function fmtShares(v: number): string {
    return Math.round(v).toLocaleString('en-US');
}

function fmtPrice(v: number | null): string {
    return v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 2026-10-02 → 10/02/26, the way a brokerage prints an option symbol.
function fmtExpiry(e: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e);
    return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : e;
}

const ROLE_LABEL: Record<ApiPositionLeg['role'], string> = {
    'written-call': 'Written call',
    'written-put': 'Written put',
    'long-call': 'Long call',
    'long-put': 'Long put',
    synthetic: 'Synthetic stock',
};

const ROLE_COLOR: Record<ApiPositionLeg['role'], string> = {
    'written-call': 'text-warning',
    'written-put': 'text-equity',
    'long-call': 'text-buy',
    'long-put': 'text-buy',
    synthetic: 'text-slate-500',
};

function coverageColor(pct: number): string {
    if (pct >= 90) return 'var(--buy)';
    if (pct >= 40) return 'var(--warning)';
    return 'var(--sell)';
}

function CoverageBar({ pct }: { pct: number | null }) {
    if (pct == null) return <span className="text-slate-600">—</span>;
    return (
        <span className="inline-flex items-center gap-1.5 justify-end">
            <span className="font-mono tabular-nums text-xs">{Math.round(pct)}%</span>
            <span className="hidden sm:inline-block w-12 h-1.5 rounded-full bg-slate-800 overflow-hidden" aria-hidden>
                <span className="block h-full" style={{ width: `${Math.min(100, pct)}%`, background: coverageColor(pct) }} />
            </span>
        </span>
    );
}

// Shared column template so header, stock rows and leg rows line up.
// Mobile keeps Symbol / Mkt value / Covered; Qty, Price and Wt% join at sm+.
const COLS = 'grid grid-cols-[1fr_auto_auto] sm:grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr_0.6fr_0.9fr] gap-x-3 items-center';

function LegRow({ leg }: { leg: ApiPositionLeg }) {
    const symbol = `${fmtExpiry(leg.expiry)} ${leg.strike} ${leg.optionType.toUpperCase().startsWith('C') ? 'C' : 'P'}`;
    const note: string[] = [];
    if (leg.expired) note.push('expired');
    else if (leg.dte != null) note.push(`${Math.round(leg.dte)} DTE`);
    if (leg.upsideRoomPct != null) {
        note.push(leg.upsideRoomPct >= 0
            ? `${leg.upsideRoomPct.toFixed(1)}% upside room`
            : `ITM by ${Math.abs(leg.upsideRoomPct).toFixed(1)}%`);
    }
    return (
        <div className={`${COLS} py-1.5 pl-6 pr-2 text-[11px] ${leg.expired ? 'opacity-50' : ''}`}>
            <div className="min-w-0">
                <span className="font-mono text-slate-300">{symbol}</span>
                <span className={`ml-2 ${ROLE_COLOR[leg.role]}`}>{ROLE_LABEL[leg.role]}</span>
                {note.length > 0 && <span className="block text-slate-500">{note.join(' · ')}</span>}
            </div>
            <div className="hidden sm:block text-right font-mono tabular-nums text-slate-400">
                {leg.contracts > 0 ? '+' : ''}{fmtShares(leg.contracts)}
            </div>
            <div className="hidden sm:block text-right font-mono tabular-nums text-slate-500">{fmtPrice(leg.price)}</div>
            <div className="text-right font-mono tabular-nums text-slate-400">{fmtMoney(leg.marketValue)}</div>
            <div className="hidden sm:block text-right font-mono tabular-nums text-slate-500">{leg.weight.toFixed(2)}%</div>
            <div />
        </div>
    );
}

function PositionRow({ p }: { p: ApiPosition }) {
    const synthetic = p.syntheticShares !== 0;
    const short = p.totalShares < 0;
    const qtyNote = synthetic
        ? p.sharesHeld !== 0
            ? `${fmtShares(p.sharesHeld)} held + ${fmtShares(p.syntheticShares)} synthetic`
            : 'all synthetic'
        : short ? 'short' : null;
    const liveLegs = p.legs.filter(l => !l.expired).length;
    return (
        <details className="group border-b border-rule last:border-b-0">
            <summary className={`${COLS} cursor-pointer list-none py-2.5 px-2 hover:bg-white/[0.02] [&::-webkit-details-marker]:hidden`}>
                <div className="min-w-0 flex items-center gap-1.5">
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90 ${p.legs.length ? '' : 'invisible'}`} />
                    <div className="min-w-0">
                        <Link href={`/stocks/${p.ticker}`} className="font-mono font-bold text-sm text-equity hover:underline">
                            {p.ticker}
                        </Link>
                        {synthetic && <span className="ml-1 text-slate-500 text-xs" title="Includes synthetic shares (long call + short put)">*</span>}
                        <span className="block text-[10px] text-slate-500 truncate">
                            {qtyNote ?? p.name}
                            {liveLegs > 0 && ` · ${liveLegs} option leg${liveLegs === 1 ? '' : 's'}`}
                        </span>
                    </div>
                </div>
                <div className="hidden sm:block text-right font-mono tabular-nums text-xs text-slate-200">
                    {fmtShares(p.totalShares)}
                </div>
                <div className="hidden sm:block text-right font-mono tabular-nums text-xs text-slate-400">
                    {p.spotSuppressed ? <span title="The fund's mark and the quote feed disagree">n/a</span> : fmtPrice(p.price)}
                </div>
                <div className="text-right font-mono tabular-nums text-xs text-slate-200">{fmtMoney(p.exposureValue)}</div>
                <div className="hidden sm:block text-right font-mono tabular-nums text-xs text-slate-400">
                    {p.exposurePctNav != null ? `${p.exposurePctNav.toFixed(1)}%` : `${p.weight.toFixed(1)}%`}
                </div>
                <div className="text-right">
                    <CoverageBar pct={p.coveragePct} />
                    {p.nakedShares > 0 && (
                        <span className="block text-[10px] text-sell">{fmtShares(p.nakedShares)} sh naked</span>
                    )}
                </div>
            </summary>
            {p.legs.length > 0 && (
                <div className="bg-black/20 border-t border-rule/60">
                    {p.legs.map((l, i) => <LegRow key={i} leg={l} />)}
                </div>
            )}
        </details>
    );
}

export function FundPositions({ income }: { income: ApiIncomeFund }) {
    const positions = income.positions;
    const summary = income.positionsSummary;
    if (!positions || !summary) return null;

    const stockRows = positions.filter(p => p.totalShares !== 0);
    // Option-only names: long calls/puts on an index or ETF the fund doesn't
    // hold as stock (e.g. KQQQ's MAGS puts, QDTE's NDX calls).
    const optionOnly = positions.filter(p => p.totalShares === 0 && p.legs.length > 0);
    const others = income.otherPositions ?? [];
    const anySynthetic = stockRows.some(p => p.syntheticShares !== 0);
    const isShort = income.archetype === 'short-equity';

    return (
        <Card className="bg-surface border-rule">
            <CardHeader className="pb-3 border-b border-rule">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-white flex-wrap">
                    <Wallet className="h-5 w-5 text-equity" /> Positions
                    <span className="text-xs font-normal text-slate-500">as of {income.asOfDate}</span>
                </CardTitle>
                {summary.coveredPct != null ? (
                    <div className="pt-3 space-y-2">
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                            <span>
                                <span className="font-mono font-bold text-buy">{summary.coveredPct.toFixed(0)}%</span>
                                <span className="text-slate-400"> covered</span>
                            </span>
                            <span>
                                <span className="font-mono font-bold text-sell">{summary.uncoveredPct?.toFixed(0)}%</span>
                                <span className="text-slate-400"> uncovered</span>
                            </span>
                            {!!summary.syntheticPct && (
                                <span>
                                    <span className="font-mono font-bold text-slate-300">{summary.syntheticPct.toFixed(0)}%</span>
                                    <span className="text-slate-400"> held synthetically</span>
                                </span>
                            )}
                        </div>
                        <div className="flex h-2 rounded-full overflow-hidden bg-slate-800" aria-hidden>
                            <div style={{ width: `${summary.coveredPct}%`, background: 'var(--buy)' }} />
                            <div style={{ width: `${summary.uncoveredPct ?? 0}%`, background: 'var(--sell)', opacity: 0.6 }} />
                        </div>
                        <p className="text-[11px] text-slate-500">
                            Share of the {fmtMoney(summary.stockExposureValue)} {isShort ? 'short ' : ''}stock book
                            with {isShort ? 'a put written against it' : 'a call written against it'}, by value.
                            {' '}Uncovered stock keeps all of its upside and pays no premium.
                        </p>
                    </div>
                ) : (
                    <p className="pt-3 text-xs text-slate-500">
                        {income.incomeLegVisible
                            ? 'No stock position to cover in the latest snapshot.'
                            : 'This fund writes its income options intraday, so they never appear in an end-of-day holdings file — coverage cannot be measured.'}
                    </p>
                )}
            </CardHeader>
            <CardContent className="pt-2 px-2 sm:px-4">
                {stockRows.length > 0 && (
                    <>
                        <div className={`${COLS} px-2 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-rule`}>
                            <div>Symbol</div>
                            <div className="hidden sm:block text-right">Qty</div>
                            <div className="hidden sm:block text-right">Price</div>
                            <div className="text-right">Mkt value</div>
                            <div className="hidden sm:block text-right">% NAV</div>
                            <div className="text-right">Covered</div>
                        </div>
                        {stockRows.map(p => <PositionRow key={p.ticker} p={p} />)}
                    </>
                )}
                {optionOnly.length > 0 && (
                    <>
                        <div className="px-2 pt-4 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
                            Options without a stock position
                        </div>
                        {optionOnly.map(p => (
                            <div key={p.ticker} className="border-b border-rule last:border-b-0">
                                <div className="px-2 pt-2 font-mono font-bold text-sm text-slate-300">{p.ticker}</div>
                                {p.legs.map((l, i) => <LegRow key={i} leg={l} />)}
                            </div>
                        ))}
                    </>
                )}
                {others.length > 0 && (
                    <div className="mt-2 border-t border-rule">
                        {others.map(o => (
                            <div key={o.sleeve} className={`${COLS} px-2 py-2 text-xs text-slate-400`}>
                                <div className="pl-5">
                                    {o.label}
                                    <span className="block text-[10px] text-slate-600">{o.lines} line{o.lines === 1 ? '' : 's'}</span>
                                </div>
                                <div className="hidden sm:block" />
                                <div className="hidden sm:block" />
                                <div className="text-right font-mono tabular-nums">{fmtMoney(o.marketValue)}</div>
                                <div className="hidden sm:block text-right font-mono tabular-nums">{o.weight.toFixed(1)}%</div>
                                <div />
                            </div>
                        ))}
                    </div>
                )}
                {anySynthetic && (
                    <p className="px-2 pt-3 text-[10px] text-slate-500">
                        * Includes synthetic shares — a long call and short put at the same strike and expiry,
                        which behaves like owning 100 shares per contract. Market value shows the stock
                        exposure, not the option premium.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
