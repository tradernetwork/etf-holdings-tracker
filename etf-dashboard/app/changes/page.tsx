import { api } from '@/lib/api';
import { PROVIDER_ORDER } from '@/lib/holdings';
import { ArrowLeft, Share2 } from 'lucide-react';
import Link from 'next/link';
import { ChangesClient } from '@/components/changes-client';
import { InstitutionalSummary } from '@/components/institutional-summary';
import { InstitutionalTrend } from '@/components/institutional-trend';
import { SiteNav } from '@/components/site-nav';

export const dynamic = 'force-dynamic';

function formatAsOfDate(asOf: string): string {
    return new Date(`${asOf}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
}

type Period = 'daily' | 'weekly' | 'monthly';
const PERIODS: { key: Period; label: string }[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Past 7 days' },
    { key: 'monthly', label: 'Past 30 days' },
];
const HEADLINE: Record<Period, string> = {
    daily: 'since yesterday',
    weekly: 'over the past 7 days',
    monthly: 'over the past 30 days',
};

export default async function ChangesPage({
    searchParams,
}: {
    searchParams: Promise<{ period?: string }>;
}) {
    const sp = await searchParams;
    const period: Period =
        sp.period === 'weekly' || sp.period === 'monthly' ? sp.period : 'daily';

    // Pull the full (uncapped) change list for the window — the headline
    // /signals payload truncates to the top 50 by magnitude, which silently
    // drops broad value funds like Avantis whose per-name deltas are tiny.
    // Equity changes come from /changes; option activity from /activity.
    const [changesResp, activity, institutional, trend] = await Promise.all([
        api.changes({ period, limit: 5000 }),
        api.activity(period),
        api.institutional(period, 25),
        api.institutionalTrend(12),
    ]);

    const asOfDate = changesResp?.asOfDate ?? 'unknown';

    const allChanges: {
        fund: string; ticker: string; name: string;
        type: string; weightDelta: number; activeWeightDelta?: number; isOption: boolean;
        sector?: string; underlying?: string;
    }[] = [];

    const equity = changesResp?.changes ?? [];
    const options = activity?.optionsActivity ?? [];
    for (const c of [...equity, ...options]) {
        allChanges.push({
            fund: c.fund,
            ticker: c.ticker,
            name: c.name,
            type: c.type,
            weightDelta: c.weightDelta,
            activeWeightDelta: c.activeWeightDelta,
            isOption: c.isOption,
            sector: c.sector || undefined,
            underlying: c.optionDetails?.underlying,
        });
    }

    allChanges.sort((a, b) =>
        Math.abs(b.activeWeightDelta ?? b.weightDelta) - Math.abs(a.activeWeightDelta ?? a.weightDelta));

    const shareText = `${allChanges.length} ETF position changes across ${new Set(allChanges.map(c => c.fund)).size} funds. See what the institutions are doing before the herd does.`;
    const shareUrl = 'https://tickertrace.pro/changes';

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 space-y-6 font-sans">
            <SiteNav />
            <div className="bg-surface border border-rule p-4 rounded-xl shadow-lg">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <Link href="/dashboard" className="text-xs text-slate-500 hover:text-white transition-colors flex items-center gap-1 mb-2">
                            <ArrowLeft className="h-3 w-3" /> Back to Dashboard
                        </Link>
                        <h1 className="text-2xl font-black tracking-tight">
                            <span className="text-equity">What changed</span> {HEADLINE[period]}?
                        </h1>
                        <p className="text-sm text-slate-400 font-mono mt-1">
                            {asOfDate !== 'unknown' ? formatAsOfDate(asOfDate) : asOfDate} · {allChanges.length} position changes across {new Set(allChanges.map(c => c.fund)).size} funds
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 hidden sm:inline"><Share2 className="h-3 w-3 inline mr-1" />Share</span>
                        <a
                            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="p-2 bg-canvas border border-rule rounded-lg hover:border-[#1d9bf0] transition-colors"
                            title="Share on X"
                        >
                            <svg className="h-4 w-4 text-slate-400 hover:text-[#1d9bf0]" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                        </a>
                        <a
                            href={`https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareText)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="p-2 bg-canvas border border-rule rounded-lg hover:border-[#ff4500] transition-colors"
                            title="Share on Reddit"
                        >
                            <svg className="h-4 w-4 text-slate-400 hover:text-[#ff4500]" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" /></svg>
                        </a>
                    </div>
                </div>
            </div>

            {/* Window toggle — daily / weekly / monthly. Slow-moving value funds
                only show meaningful flow over a week or month. */}
            <div className="flex gap-1.5">
                {PERIODS.map(p => (
                    <Link
                        key={p.key}
                        href={p.key === 'daily' ? '/changes' : `/changes?period=${p.key}`}
                        scroll={false}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${period === p.key
                            ? 'bg-equity/20 border-equity/40 text-equity'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >{p.label}</Link>
                ))}
            </div>

            {institutional && <InstitutionalSummary flow={institutional} />}

            {trend && <InstitutionalTrend trend={trend} />}

            <ChangesClient
                changes={allChanges}
                asOfDate={asOfDate}
                providers={PROVIDER_ORDER}
            />
        </div>
    );
}
