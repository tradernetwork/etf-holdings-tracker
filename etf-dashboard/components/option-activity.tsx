// Dated option activity for an option-income fund.
//
// Replaces two older cards: "Option Rolls" and the ADDED/TRIMMED "Options
// Activity" grid. The grid was driven by WEIGHT changes, which move with
// price even when no contract trades (KQQQ's synthetic legs read TRIMMED on a
// day they held 238 contracts both sides), carried no date and no size, and
// labelled every call "Capping upside" whether it was written or bought.
//
// This is built from CONTRACT changes (api/structures.py), day by day, each
// paired into what it is — a roll, a spread, a synthetic — with signed sizes.
// Pure server component; older days collapse into a native <details>.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiActivityLeg, ApiOptionActivityDay, ApiOptionTrade } from '@/lib/api';
import { ArrowRight, Zap } from 'lucide-react';
import Link from 'next/link';

function fmtDay(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
}

function fmtShort(iso: string | null): string {
    const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
    return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : (iso ?? '—');
}

function fmtN(v: number): string {
    return Math.round(v).toLocaleString('en-US');
}

function fmtSigned(v: number): string {
    return `${v > 0 ? '+' : ''}${fmtN(v)}`;
}

function legName(l: ApiActivityLeg): string {
    return `${l.strike ?? '?'}${l.optionType === 'PUT' ? 'P' : 'C'} ${fmtShort(l.expiry)}`;
}

const KIND_STYLE: Record<string, string> = {
    roll: 'border-meta/40 bg-meta/10 text-meta',
    spread: 'border-equity/40 bg-equity/10 text-equity',
    synthetic: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
    collar: 'border-buy/40 bg-buy/10 text-buy',
    open: 'border-equity/40 bg-equity/10 text-equity',
    add: 'border-equity/40 bg-equity/10 text-equity',
    close: 'border-rule bg-surface-alt text-slate-400',
    expired: 'border-rule bg-surface-alt text-slate-500',
    reduce: 'border-rule bg-surface-alt text-slate-400',
    flip: 'border-warning/40 bg-warning/10 text-warning',
    pair: 'border-rule bg-surface-alt text-slate-400',
};

const ACTION_LABEL: Record<string, string> = {
    open: 'Opened', close: 'Closed', expired: 'Expired', add: 'Added', reduce: 'Reduced', flip: 'Flipped',
};

/** Opened / closed / adjusted, for a paired structure. */
function lifecycle(legs: ApiActivityLeg[]): string {
    if (legs.every(l => !l.prevContracts)) return 'opened';
    if (legs.every(l => !l.contracts)) return 'closed';
    return 'resized';
}

function describe(t: ApiOptionTrade): { badge: string; text: React.ReactNode } {
    const legs = t.legs;
    const [a, b] = legs;
    switch (t.kind) {
        case 'roll': {
            const from = legs.find(l => l.change !== 0 && Math.abs(l.contracts) < Math.abs(l.prevContracts)) ?? a;
            const to = legs.find(l => l !== from) ?? b;
            const side = (to.contracts || from.prevContracts) < 0 ? 'written' : 'long';
            return {
                badge: 'Roll',
                text: (
                    <span className="inline-flex items-center gap-1 flex-wrap">
                        <span className="text-slate-500 line-through">{legName(from)}</span>
                        <ArrowRight className="h-3 w-3 text-meta shrink-0" />
                        <span className="text-slate-200">{legName(to)}</span>
                        <span className="text-slate-500">· {side}</span>
                    </span>
                ),
            };
        }
        case 'spread': {
            const short = legs.find(l => (l.contracts || l.prevContracts) < 0) ?? a;
            const long_ = legs.find(l => l !== short) ?? b;
            const call = short.optionType === 'CALL';
            const credit = call ? (short.strike ?? 0) < (long_.strike ?? 0) : (short.strike ?? 0) > (long_.strike ?? 0);
            return {
                badge: 'Spread',
                text: <>{fmtShort(short.expiry)} {short.strike}/{long_.strike} {call ? 'call' : 'put'} spread · {credit ? 'credit' : 'debit'} · {lifecycle(legs)}</>,
            };
        }
        case 'synthetic': {
            const call = legs.find(l => l.optionType === 'CALL') ?? a;
            const long = (call.contracts || -call.prevContracts) > 0 || call.change > 0;
            return {
                badge: 'Synthetic',
                text: <>{fmtShort(call.expiry)} {call.strike} synthetic {long ? 'long' : 'short'} (stock exposure) · {lifecycle(legs)}</>,
            };
        }
        case 'collar': {
            const c = legs.find(l => l.optionType === 'CALL') ?? a;
            const p = legs.find(l => l.optionType === 'PUT') ?? b;
            return { badge: 'Collar', text: <>{fmtShort(c.expiry)} {c.strike}C / {p.strike}P collar · {lifecycle(legs)}</> };
        }
        case 'pair':
            return { badge: 'Pair', text: <>{legs.map(legName).join(' + ')} · equal size, no standard shape</> };
        default: {
            const side = (a.contracts || a.prevContracts) < 0 ? 'written' : 'long';
            return {
                badge: ACTION_LABEL[t.action ?? ''] ?? 'Change',
                text: <>{legName(a)} · {side}</>,
            };
        }
    }
}

function TradeRow({ t }: { t: ApiOptionTrade }) {
    const { badge, text } = describe(t);
    const styleKey = t.kind === 'single' ? (t.action ?? 'pair') : t.kind;
    return (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[5.5rem_4.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 items-baseline py-2 px-2 border-b border-rule/60 last:border-b-0">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border w-fit ${KIND_STYLE[styleKey] ?? KIND_STYLE.pair}`}>
                {badge}
            </span>
            <Link href={`/stocks/${t.underlying}`} className="font-mono font-bold text-sm text-equity hover:underline sm:order-none">
                {t.underlying}
            </Link>
            <div className="col-span-2 sm:col-span-1 min-w-0 text-xs text-slate-300">
                {text}
                <div className="font-mono text-[10px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                    {t.legs.map((l, i) => (
                        <span key={i}>
                            {legName(l)}{' '}
                            <span className={l.change < 0 ? 'text-warning' : 'text-buy'}>{fmtSigned(l.change)}</span>
                            <span className="text-slate-600"> ({fmtN(l.prevContracts)} → {fmtN(l.contracts)})</span>
                            {l.isFlex && <span className="ml-1 text-slate-600">FLEX</span>}
                        </span>
                    ))}
                </div>
            </div>
            <span className="hidden sm:block text-right font-mono text-xs text-slate-400 whitespace-nowrap">
                {fmtN(t.size)} ct
            </span>
        </div>
    );
}

function Day({ d }: { d: ApiOptionActivityDay }) {
    return (
        <div>
            <div className="flex items-baseline gap-2 px-2 pt-3 pb-1.5 border-b border-rule">
                <span className="text-sm font-bold text-slate-200">{fmtDay(d.date)}</span>
                <span className="text-[11px] text-slate-500">vs {fmtDay(d.compareDate)}</span>
                <span className="text-[11px] text-slate-500 ml-auto">
                    {d.refreshed === false
                        ? 'not refreshed — issuer file unavailable'
                        : d.trades.length === 0
                            ? 'no option trades'
                            : `${d.trades.length} trade${d.trades.length === 1 ? '' : 's'}`}
                </span>
            </div>
            {d.trades.map((t, i) => <TradeRow key={i} t={t} />)}
        </div>
    );
}

export function OptionActivity({ days }: { days: ApiOptionActivityDay[] }) {
    if (days.length === 0) return null;
    const recent = days.slice(0, 3);
    const older = days.slice(3);
    const counts = days.reduce<Record<string, number>>((m, d) => {
        for (const t of d.trades) m[t.kind === 'single' ? (t.action ?? 'change') : t.kind] = (m[t.kind === 'single' ? (t.action ?? 'change') : t.kind] ?? 0) + 1;
        return m;
    }, {});
    // Structures pluralise ("14 rolls"); actions don't ("5 expired", "3 opened").
    const NOUN: Record<string, [string, string]> = {
        roll: ['roll', 'rolls'], spread: ['spread', 'spreads'], synthetic: ['synthetic', 'synthetics'],
        collar: ['collar', 'collars'], pair: ['other pair', 'other pairs'],
    };
    const summary = Object.entries(counts).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${NOUN[k] ? NOUN[k][n === 1 ? 0 : 1] : (ACTION_LABEL[k] ?? k).toLowerCase()}`);
    return (
        <Card className="bg-surface border-rule">
            <CardHeader className="pb-3 border-b border-rule">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-white flex-wrap">
                    <Zap className="h-5 w-5 text-warning" /> Option Activity
                    <span className="text-xs font-normal text-slate-500">
                        {fmtDay(days[days.length - 1].compareDate)} – {fmtDay(days[0].date)}
                    </span>
                </CardTitle>
                {summary.length > 0 && (
                    <p className="pt-1 text-[11px] text-slate-500">{summary.join(' · ')}</p>
                )}
            </CardHeader>
            <CardContent className="pt-0 px-2 sm:px-4">
                {recent.map(d => <Day key={d.date} d={d} />)}
                {older.length > 0 && (
                    <details className="group">
                        <summary className="cursor-pointer list-none px-2 py-3 text-xs text-slate-400 hover:text-slate-200 [&::-webkit-details-marker]:hidden">
                            <span className="group-open:hidden">Show {older.length} earlier day{older.length === 1 ? '' : 's'}</span>
                            <span className="hidden group-open:inline">Hide earlier days</span>
                        </summary>
                        {older.map(d => <Day key={d.date} d={d} />)}
                    </details>
                )}
                <p className="px-2 pt-3 text-[10px] text-slate-600">
                    Built from contract counts, not weights — a price move can&apos;t show up as a trade.
                    Changes of equal size on the same stock are paired: a roll closes one expiry and
                    opens the next, a synthetic (long call + written put at one strike) is stock
                    exposure, not two bets. Negative = written.
                </p>
            </CardContent>
        </Card>
    );
}
