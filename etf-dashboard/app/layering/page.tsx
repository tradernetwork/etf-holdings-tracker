import { api } from '@/lib/api';
import { SiteNav } from '@/components/site-nav';
import { Layers, ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { formatAum } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function formatAsOfDate(asOf: string): string {
    return new Date(`${asOf}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
}

const WINDOWS = [5, 7, 10];

/** Subtle per-family accent so the ribbon reads as "different shops agreeing". */
const PROVIDER_ACCENT: Record<string, string> = {
    'Avantis': 'border-equity/40 text-equity',
    'ARK Invest': 'border-buy/40 text-buy',
    'Corgi Funds': 'border-meta/40 text-meta-bright',
    'Sprott': 'border-income/40 text-income',
    'Amplify': 'border-[#38bdf8]/40 text-equity-bright',
    'Tidal / NestYield': 'border-[#f472b6]/40 text-[#f472b6]',
    'Tidal / NicholasX': 'border-[#fb923c]/40 text-[#fb923c]',
};
const accent = (p: string) => PROVIDER_ACCENT[p] ?? 'border-rule-strong text-slate-300';

export default async function LayeringPage({
    searchParams,
}: {
    searchParams: Promise<{ window?: string }>;
}) {
    const sp = await searchParams;
    const windowDays = WINDOWS.includes(Number(sp.window)) ? Number(sp.window) : 7;

    const resp = await api.layering({ windowDays, minFunds: 3, limit: 25 });
    const patterns = resp?.patterns ?? [];

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 space-y-6 font-sans">
            <SiteNav />

            <div className="bg-surface border border-rule p-4 rounded-xl shadow-lg">
                <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                    <Layers className="h-6 w-6 text-equity" />
                    Layering Radar
                </h1>
                <p className="text-sm text-slate-400 mt-1 max-w-3xl">
                    When <span className="text-white font-semibold">3+ institutional stock-pickers</span> each open the{' '}
                    <span className="text-white font-semibold">same brand-new position</span> within {windowDays} trading days,
                    that&apos;s smart money quietly piling in. Cross-<span className="italic">family</span> pile-ups rank highest —
                    and the entry <span className="text-white font-semibold">order</span> is the part a quarterly 13F can never show you.
                </p>
            </div>

            <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500 font-mono mr-1">window:</span>
                {WINDOWS.map(w => (
                    <Link
                        key={w}
                        href={`/layering?window=${w}`}
                        scroll={false}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${windowDays === w
                            ? 'bg-equity/20 border-equity/40 text-equity'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >{w} days</Link>
                ))}
                {resp && (
                    <span className="text-[11px] text-slate-600 font-mono ml-auto">
                        {resp.total} active pattern{resp.total === 1 ? '' : 's'} · as of {formatAsOfDate(resp.asOfDate)}
                    </span>
                )}
            </div>

            {patterns.length === 0 ? (
                <div className="bg-surface border border-rule rounded-xl p-10 text-center">
                    <Sparkles className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">No layering patterns in the last {windowDays} trading days.</p>
                    <p className="text-slate-600 text-sm mt-1">Try a wider window, or check back after the next scrape.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {patterns.map((p, i) => {
                        const families = p.distinctProviders;
                        const crossFamily = families >= 2;
                        return (
                            <div key={p.ticker} className="bg-surface border border-rule rounded-xl p-4 hover:border-[#2a3a52] transition-colors">
                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono text-slate-600 text-sm">#{i + 1}</span>
                                            <Link href={`/stocks/${p.ticker}`} className="font-mono font-black text-lg text-equity hover:underline">
                                                {p.ticker}
                                            </Link>
                                            <span className="text-slate-400 text-sm truncate max-w-[260px]">{p.name}</span>
                                            {p.sector && <span className="text-[10px] text-slate-600 px-1.5 py-0.5 rounded border border-rule">{p.sector}</span>}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-2 flex-wrap">
                                            <span className="text-white font-semibold">{p.distinctFunds} funds</span>
                                            <span>·</span>
                                            <span className={crossFamily ? 'text-buy font-semibold' : ''}>
                                                {families} {families === 1 ? 'family' : 'families'}
                                                {crossFamily && ' (cross-family)'}
                                            </span>
                                            <span>·</span>
                                            <span className="font-mono">{formatAum(p.consensusAum)} combined AUM</span>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0" title="Layering strength (0–100): blends how many distinct funds entered, how many separate fund families (cross-family agreement weighted highest), and their combined AUM. Scaled against the strongest active pattern.">
                                        <div className="text-2xl font-black font-mono text-equity">{p.layeringStrength}</div>
                                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">strength</div>
                                    </div>
                                </div>

                                {/* Strength bar */}
                                <div className="mt-3 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-equity to-buy" style={{ width: `${p.layeringStrength}%` }} />
                                </div>

                                {/* Entry-sequence ribbon — first mover → last */}
                                <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                                    {p.entrySequence.map((e, j) => (
                                        <div key={`${e.fund}-${j}`} className="flex items-center gap-1.5">
                                            {j > 0 && <ArrowRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />}
                                            <Link
                                                href={`/fund/${e.fund}`}
                                                title={`${e.provider} · entered ${e.entryDate} at ${e.weight}% weight`}
                                                className={`inline-flex flex-col items-start px-2 py-1 rounded-md border bg-surface-alt hover:bg-surface-hover transition-colors ${accent(e.provider)} ${e.daysIntoLayering === 0 ? 'ring-1 ring-equity/30' : ''}`}
                                            >
                                                <span className="font-mono text-xs font-bold leading-none">{e.fund}</span>
                                                <span className="text-[9px] text-slate-500 font-mono leading-none mt-0.5">
                                                    {e.entryDate.slice(5)}{e.daysIntoLayering === 0 ? ' · 1st' : ` · +${e.daysIntoLayering}d`}
                                                </span>
                                            </Link>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <p className="text-[11px] text-slate-600 text-center pt-2">
                Layering = independent funds opening the same new position within days. Higher strength = more funds, more
                families, more AUM. Not financial advice — a map of where institutional money is quietly clustering.
            </p>
        </div>
    );
}
