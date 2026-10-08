import { api } from '@/lib/api';
import type { ApiFundSummary, FundCategory, ApiChangeRecord } from '@/lib/api';
import { SiteNav } from '@/components/site-nav';
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/data-table';
import { Building2, AlertCircle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import Link from 'next/link';
import { formatAum } from '@/lib/utils';
import { PROVIDER_ORDER } from '@/lib/providers';

export const dynamic = 'force-dynamic';

type Sort = 'aum' | 'holdings' | 'name';
const SORTS: { key: Sort; label: string }[] = [
    { key: 'aum', label: 'Largest AUM' },
    { key: 'holdings', label: 'Most holdings' },
    { key: 'name', label: 'A–Z' },
];

const CATEGORIES: { key: FundCategory | 'all'; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active-equity', label: 'Active Equity' },
    { key: 'option-income', label: 'Option Income' },
];

function formatAsOfDate(asOf: string): string {
    return new Date(`${asOf}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
}

function sortFunds(funds: ApiFundSummary[], sort: Sort): ApiFundSummary[] {
    const f = [...funds];
    if (sort === 'holdings') return f.sort((a, b) => (b.holdingsCount ?? 0) - (a.holdingsCount ?? 0));
    if (sort === 'name') return f.sort((a, b) => a.fund.localeCompare(b.fund));
    return f.sort((a, b) => (b.aum ?? 0) - (a.aum ?? 0));
}

/** Build a /funds URL preserving whichever params are active. */
function fundsUrl(params: { sort?: Sort; category?: FundCategory | 'all'; provider?: string }): string {
    const sp = new URLSearchParams();
    if (params.sort && params.sort !== 'aum') sp.set('sort', params.sort);
    if (params.category && params.category !== 'all') sp.set('category', params.category);
    if (params.provider) sp.set('provider', params.provider);
    const qs = sp.toString();
    return `/funds${qs ? `?${qs}` : ''}`;
}

/** Per-fund top equity mover today — biggest absolute active weight delta. */
interface TopMover {
    ticker: string;
    name: string;
    delta: number;
    type: string;
}

function buildTopMovers(changes: ApiChangeRecord[]): Map<string, TopMover> {
    const map = new Map<string, TopMover>();
    for (const c of changes) {
        if (c.isOption) continue;
        const delta = c.activeWeightDelta ?? c.weightDelta;
        const existing = map.get(c.fund);
        if (!existing || Math.abs(delta) > Math.abs(existing.delta)) {
            map.set(c.fund, { ticker: c.ticker, name: c.name, delta, type: c.type });
        }
    }
    return map;
}

/** Per-fund today: equity positions that grew (buys) vs. shrank (sells) in active weight. */
interface FundActivity {
    buys: number;
    sells: number;
}

function buildFundActivity(changes: ApiChangeRecord[]): Map<string, FundActivity> {
    const map = new Map<string, FundActivity>();
    for (const c of changes) {
        if (c.isOption) continue;
        const delta = c.activeWeightDelta ?? c.weightDelta;
        if (delta === 0) continue;
        const act = map.get(c.fund) ?? { buys: 0, sells: 0 };
        if (delta > 0) act.buys++;
        else act.sells++;
        map.set(c.fund, act);
    }
    return map;
}

export default async function FundsPage({
    searchParams,
}: {
    searchParams: Promise<{ sort?: string; category?: string; provider?: string }>;
}) {
    const sp = await searchParams;
    const sort: Sort = sp.sort === 'holdings' || sp.sort === 'name' ? sp.sort : 'aum';
    const category: FundCategory | 'all' =
        sp.category === 'active-equity' || sp.category === 'option-income'
            ? sp.category
            : 'all';
    const provider = sp.provider ?? '';

    // revalidate: 0 (uncached) on purpose. /api/v1/funds was cached site-wide
    // by the dashboard before it grew holdingsCount/topHolding, so Vercel's
    // persistent Data Cache would otherwise serve the stale thin shape here
    // (rendering "—" in the Holdings/Top-holding columns). The endpoint is
    // cheap and this index page should reflect current holdings anyway.
    const [resp, changesResp] = await Promise.all([
        api.funds({ revalidate: 0 }),
        api.changes({ period: 'daily', limit: 5000 }, { revalidate: 0, throwOnError: false }),
    ]);

    const allFunds = resp?.funds ?? [];

    // Build the list of providers present in the data, in canonical order.
    const allProviders = PROVIDER_ORDER.filter(prov => allFunds.some(f => f.provider === prov));

    // Apply category filter, then provider filter.
    const categoryFiltered = category === 'all'
        ? allFunds
        : allFunds.filter(f => f.category === category);
    const filtered = provider
        ? categoryFiltered.filter(f => f.provider === provider)
        : categoryFiltered;
    const funds = sortFunds(filtered, sort);

    // Provider pill counts: how many funds you'd see if you clicked each provider,
    // accounting for the current category filter.
    const providerCounts = new Map<string, number>();
    categoryFiltered.forEach(f => providerCounts.set(f.provider, (providerCounts.get(f.provider) ?? 0) + 1));

    const topMovers = changesResp ? buildTopMovers(changesResp.changes) : new Map<string, TopMover>();
    const fundActivity = changesResp ? buildFundActivity(changesResp.changes) : new Map<string, FundActivity>();

    const totalAum = funds.reduce((s, f) => s + (f.aum ?? 0), 0);
    const providerCount = new Set(funds.map(f => f.provider)).size;
    const categoryLabel = category === 'active-equity' ? 'active equity ' : category === 'option-income' ? 'option income ' : '';

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 space-y-6 font-sans">
            <SiteNav />

            <div className="bg-surface border border-rule p-4 rounded-xl shadow-lg">
                <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                    <Building2 className="h-6 w-6 text-equity" />
                    Funds we track
                </h1>
                <p className="text-sm text-slate-400 font-mono mt-1">
                    {resp === null
                        ? 'Data unavailable — refresh to try again'
                        : `${resp.asOfDate ? `${formatAsOfDate(resp.asOfDate)} · ` : ''}${funds.length} ${categoryLabel}funds${provider ? ` · ${provider}` : ` · ${providerCount} providers`} · $${totalAum.toFixed(1)}B combined AUM`}
                </p>
            </div>

            {/* Sort pills */}
            <div className="flex gap-1.5 flex-wrap">
                {SORTS.map(s => (
                    <Link
                        key={s.key}
                        href={fundsUrl({ sort: s.key, category: category !== 'all' ? category : undefined, provider: provider || undefined })}
                        scroll={false}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${sort === s.key
                            ? 'bg-equity/20 border-equity/40 text-equity'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >{s.label}</Link>
                ))}
            </div>

            {/* Category filter pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-500 font-mono shrink-0">type:</span>
                {CATEGORIES.map(c => (
                    <Link
                        key={c.key}
                        href={fundsUrl({ sort: sort !== 'aum' ? sort : undefined, category: c.key, provider: provider || undefined })}
                        scroll={false}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${category === c.key
                            ? 'bg-meta/20 border-meta/40 text-meta-bright'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >{c.label}</Link>
                ))}
            </div>

            {/* Provider filter pills — shown whenever there are 2+ providers in the data */}
            {resp !== null && allProviders.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-500 font-mono shrink-0">provider:</span>
                    <Link
                        href={fundsUrl({ sort: sort !== 'aum' ? sort : undefined, category: category !== 'all' ? category : undefined })}
                        scroll={false}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${!provider
                            ? 'bg-warning/20 border-warning/40 text-warning'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >All</Link>
                    {allProviders.map(prov => {
                        const cnt = providerCounts.get(prov) ?? 0;
                        return (
                            <Link
                                key={prov}
                                href={fundsUrl({ sort: sort !== 'aum' ? sort : undefined, category: category !== 'all' ? category : undefined, provider: prov })}
                                scroll={false}
                                className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${provider === prov
                                    ? 'bg-warning/20 border-warning/40 text-warning'
                                    : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                            >
                                {prov}{cnt > 0 && <span className="ml-1 opacity-50">({cnt})</span>}
                            </Link>
                        );
                    })}
                </div>
            )}

            {resp === null ? (
                <div className="bg-surface border border-rule rounded-xl p-10 text-center">
                    <AlertCircle className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">Couldn&apos;t reach the API right now.</p>
                    <p className="text-slate-600 text-sm mt-1">Try refreshing — the data usually comes right back.</p>
                </div>
            ) : funds.length === 0 ? (
                <div className="bg-surface border border-rule rounded-xl p-10 text-center">
                    <AlertCircle className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">
                        No {categoryLabel}funds{provider ? ` from ${provider}` : ''} in today&apos;s data.
                    </p>
                    <p className="text-slate-600 text-sm mt-1">
                        Try <Link href={fundsUrl({ sort: sort !== 'aum' ? sort : undefined })} className="text-meta hover:underline">clearing all filters</Link> to see everything.
                    </p>
                </div>
            ) : (
            (() => {
                const fundColumns: DataTableColumn[] = [
                    { key: 'fund', header: 'Fund' },
                    ...(!provider ? [{ key: 'provider', header: 'Provider' } satisfies DataTableColumn] : []),
                    { key: 'type', header: 'Type', mobilePriority: 'sm' },
                    { key: 'aum', header: 'AUM', align: 'right' },
                    { key: 'holdings', header: 'Holdings', align: 'right' },
                    { key: 'topHolding', header: 'Top holding', mobilePriority: 'md' },
                    { key: 'topMove', header: 'Top move today', mobilePriority: 'lg' },
                ];
                const rows: DataTableRow[] = funds.map((f) => {
                    const mover = topMovers.get(f.fund);
                    const activity = fundActivity.get(f.fund);
                    return {
                        key: f.fund,
                        cells: {
                            fund: (
                                <Link href={`/fund/${f.fund}`} className="font-mono font-bold text-equity hover:underline">
                                    {f.fund}
                                </Link>
                            ),
                            provider: <span className="text-slate-300">{f.provider}</span>,
                            type: category === 'all' ? (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${f.category === 'option-income'
                                    ? 'bg-meta/10 border-meta/30 text-meta-bright'
                                    : 'bg-equity/10 border-equity/30 text-equity'}`}>
                                    {f.category === 'option-income' ? 'option income' : 'active equity'}
                                </span>
                            ) : null,
                            aum: <span className="font-mono text-slate-300">{f.aum != null ? formatAum(f.aum) : '—'}</span>,
                            holdings: (
                                <span className="font-mono text-slate-300">
                                    {f.holdingsCount ?? '—'}
                                    {f.optionsCount ? <span className="text-slate-600"> +{f.optionsCount}⚡</span> : null}
                                </span>
                            ),
                            topHolding: f.topHolding ? (
                                <Link href={`/stocks/${f.topHolding.ticker}`} className="font-mono text-xs text-slate-400 hover:text-equity transition-colors">
                                    {f.topHolding.ticker} <span className="text-slate-600">({f.topHolding.weight.toFixed(1)}%)</span>
                                </Link>
                            ) : <span className="text-slate-600">—</span>,
                            topMove: !mover ? <span className="text-slate-600 text-xs">—</span> : (
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <Link
                                            href={`/stocks/${mover.ticker}`}
                                            className={`font-mono text-xs font-bold hover:underline ${mover.delta > 0 ? 'text-buy' : 'text-sell'}`}
                                        >
                                            {mover.delta > 0
                                                ? <ArrowUpRight className="inline h-3 w-3 mr-0.5" />
                                                : <ArrowDownRight className="inline h-3 w-3 mr-0.5" />}
                                            {mover.ticker}
                                        </Link>
                                        <span className={`font-mono text-[10px] tabular-nums ${mover.delta > 0 ? 'text-buy/70' : 'text-sell/70'}`}>
                                            {mover.delta > 0 ? '+' : ''}{mover.delta.toFixed(3)}%
                                        </span>
                                        {(mover.type === 'NEW' || mover.type === 'REMOVED') && (
                                            <span className={`text-[9px] font-bold px-1 rounded border ${
                                                mover.type === 'NEW'
                                                    ? 'border-buy/30 bg-buy/10 text-buy'
                                                    : 'border-sell/30 bg-sell/10 text-sell'
                                            }`}>
                                                {mover.type === 'NEW' ? 'NEW' : 'EXIT'}
                                            </span>
                                        )}
                                    </div>
                                    {activity && (activity.buys > 0 || activity.sells > 0) && (
                                        <div
                                            className="text-[10px] font-mono mt-1"
                                            title="Count of equity positions that grew (↑) vs. shrank (↓) in active weight today"
                                        >
                                            {activity.buys > 0 && <span className="text-buy/50">+{activity.buys}↑</span>}
                                            {activity.buys > 0 && activity.sells > 0 && <span className="text-slate-700"> · </span>}
                                            {activity.sells > 0 && <span className="text-sell/50">{activity.sells}↓</span>}
                                        </div>
                                    )}
                                </div>
                            ),
                        },
                    };
                });
                return (
                    <DataTable
                        columns={fundColumns}
                        rows={rows}
                        emptyMessage="No funds match these filters."
                        wrapperClassName="rounded-lg"
                    />
                );
            })()
            )}
        </div>
    );
}
