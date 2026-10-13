import { api } from '@/lib/api';
import type { TrendSignal } from '@/lib/api';
import type { Metadata } from 'next';
import { SiteNav } from '@/components/site-nav';
import { WeightSparkline } from '@/components/weight-sparkline';
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/data-table';
import { FUND_AUM } from '@/lib/providers';
import { ShareButtons } from '@/components/share-buttons';
import { WatchButton } from '@/components/watch-star';
import { TMMark } from '@/components/tm-mark';
import { TMLink } from '@/components/tm-link';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Flame, Share2, Lock } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const SIGNAL_META: Record<TrendSignal, { label: string; cls: string }> = {
    'accumulating': { label: 'Accumulating', cls: 'text-buy border-buy/30 bg-buy/10' },
    'distribution-starting': { label: 'Selling starting', cls: 'text-warning border-warning/30 bg-warning/10' },
    'distributing': { label: 'Distributing', cls: 'text-sell border-sell/30 bg-sell/10' },
    'bottoming': { label: 'Bottoming?', cls: 'text-equity border-equity/30 bg-equity/10' },
};

function formatAsOfDate(asOf: string): string {
    const d = new Date(`${asOf}T00:00:00Z`);
    if (isNaN(d.getTime())) return asOf || '—';
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
}

function formatExpiry(expiry: string): string {
    const d = new Date(`${expiry}T00:00:00Z`);
    if (isNaN(d.getTime())) return expiry || '—';
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', timeZone: 'UTC',
    });
}

function formatExposure(m: number): string {
    if (m >= 1000) return `$${(m / 1000).toFixed(1)}B`;
    return `$${Math.round(m)}M`;
}

/** Estimate dollar exposure for one fund holding: AUM × weight%. Returns null when AUM is unknown or too small to matter. */
function fundExposure(aumB: number | null | undefined, weight: number): string | null {
    if (!aumB) return null;
    const m = weight / 100 * aumB * 1000;
    if (m < 0.5) return null;
    if (m >= 1000) return `~$${(m / 1000).toFixed(1)}B`;
    if (m >= 10) return `~$${Math.round(m)}M`;
    return `~$${m.toFixed(1)}M`;
}

function Delta({ label, value }: { label: string; value: number }) {
    const c = value > 0 ? 'text-buy' : value < 0 ? 'text-sell' : 'text-slate-500';
    return (
        <div className="bg-surface-alt border border-surface-elevated rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
            <p className={`font-mono font-semibold text-sm flex items-center justify-center gap-0.5 ${c}`}>
                {value > 0 ? <ArrowUpRight className="h-3 w-3" /> : value < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                {value > 0 ? '+' : ''}{value.toFixed(3)}%
            </p>
        </div>
    );
}

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
    const { ticker: raw } = await params;
    const ticker = decodeURIComponent(raw).toUpperCase();
    const detail = await api.stock(ticker);
    const title = detail
        ? `${ticker} — ${detail.fundCount} funds · ${detail.institutional.signal} · TickerTrace`
        : `${ticker} · TickerTrace`;
    const description = detail
        ? `${detail.name} is held by ${detail.fundCount} ETFs. Institutional blended weight: ${detail.institutional.blendedWeight.toFixed(3)}%. Track fund flows on TickerTrace.`
        : `Institutional fund flows for ${ticker} on TickerTrace.`;
    return {
        title,
        description,
        openGraph: {
            title,
            description,
            images: [`/stocks/${ticker}/opengraph-image`],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [`/stocks/${ticker}/opengraph-image`],
        },
    };
}

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
    const { ticker: raw } = await params;
    const ticker = decodeURIComponent(raw).toUpperCase();

    const [detail] = await Promise.all([
        api.stock(ticker),
    ]);
    if (!detail) notFound();

    const inst = detail.institutional;
    const sig = SIGNAL_META[inst.signal];

    // Per-fund daily change + change type for the holders table.
    const changeByFund = new Map<string, number>();
    const changeTypeByFund = new Map<string, string>();
    for (const c of detail.changes) {
        if (!c.isOption) {
            changeByFund.set(c.fund, c.activeWeightDelta ?? c.weightDelta);
            changeTypeByFund.set(c.fund, c.type);
        }
    }
    const equityHolders = detail.holdings
        .filter(h => !h.isOption)
        .sort((a, b) => b.weight - a.weight);
    const optionHolders = detail.holdings.filter(h => h.isOption)
        .sort((a, b) => b.weight - a.weight);
    const distinctFamilies = new Set(equityHolders.map(h => h.provider)).size;

    // Derive the snapshot date from the last history point — history is sorted
    // oldest → newest, so the last entry is today's snapshot.
    const asOfDate = detail.history.length > 0
        ? detail.history[detail.history.length - 1].date
        : null;

    const shareUrl = `https://tickertrace.pro/stocks/${ticker}`;
    const shareTweet = `${ticker} is held by ${detail.fundCount} ETFs — institutional blended weight ${inst.blendedWeight.toFixed(2)}%. Track fund flows on TickerTrace:`;
    const shareRedditTitle = `${ticker} institutional ETF flow — ${detail.fundCount} funds holding (${inst.signal})`;
    const shareRedditText = `${detail.name} appears in ${detail.fundCount} ETF holdings.\n\nInstitutional blended weight: ${inst.blendedWeight.toFixed(3)}% — ${inst.signal}.\n\nI track this via TickerTrace (it's my project — full disclosure). Link: ${shareUrl}`;

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 space-y-6 font-sans">
            <SiteNav />

            {/* Header */}
            <div className="bg-surface border border-rule p-4 rounded-xl shadow-lg">
                <Link href="/stocks" className="text-xs text-slate-500 hover:text-white transition-colors flex items-center gap-1 mb-2">
                    <ArrowLeft className="h-3 w-3" /> All stocks
                </Link>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-black tracking-tight font-mono text-equity">{detail.ticker}</h1>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${sig.cls}`}>{sig.label}</span>
                        </div>
                        <p className="text-sm text-slate-400 mt-1">
                            {detail.name}
                            {detail.sector && (
                                <>
                                    {' · '}
                                    <Link
                                        href={`/stocks?sector=${encodeURIComponent(detail.sector)}`}
                                        className="hover:text-meta-bright hover:underline transition-colors"
                                    >
                                        {detail.sector}
                                    </Link>
                                </>
                            )}
                        </p>
                        <p className="text-xs text-slate-500 font-mono mt-1">
                            {asOfDate && <>{formatAsOfDate(asOfDate)} · </>}
                            Held by {detail.fundCount} equity fund{detail.fundCount === 1 ? '' : 's'}
                            {detail.fundCount > 1 && <> across {distinctFamilies} {distinctFamilies === 1 ? 'family' : 'families'}</>}
                            {' · '}institutional blended weight {inst.blendedWeight.toFixed(3)}%
                            {(inst.estimatedExposureM ?? 0) > 0 && (
                                <> · ~{formatExposure(inst.estimatedExposureM!)} est. exposure</>
                            )}
                        </p>
                    </div>
                    {/* Watch + Share card buttons */}
                    <div className="flex gap-2 flex-wrap shrink-0">
                        <WatchButton type="stock" symbol={ticker} />
                        <a
                            href={`/stocks/${ticker}/opengraph-image`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 min-h-11 md:min-h-0 px-3 py-2 rounded-xl border border-rule-strong bg-surface-alt text-subtext hover:text-white text-xs font-bold transition-colors"
                        >
                            <Share2 className="h-3.5 w-3.5" />
                            Share card
                        </a>
                    </div>
                </div>
            </div>

            {/* Trend: chart + D/W/M deltas */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-surface border border-rule rounded-xl shadow-lg p-4">
                    <h2 className="text-sm font-black tracking-tight mb-1">
                        Institutional <span className="text-equity">blended weight</span> over time
                    </h2>
                    <p className="text-[11px] text-slate-500 mb-3">
                        AUM-weighted weight of {detail.ticker} across all stock-picking funds, last {detail.history.length} trading sessions.
                    </p>
                    <WeightSparkline points={detail.history} up={inst.monthly >= 0} />
                </div>
                <div className="bg-surface border border-rule rounded-xl shadow-lg p-4">
                    <h2 className="text-sm font-black tracking-tight mb-3">Net flow</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Delta label="Day" value={inst.daily} />
                        <Delta label="Week" value={inst.weekly} />
                        <Delta label="Month" value={inst.monthly} />
                    </div>
                    {inst.streak != null && (
                        <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border ${
                            inst.streak > 0
                                ? 'bg-warning/10 border-warning/30'
                                : 'bg-sell/10 border-sell/30'
                        }`}>
                            <Flame className={`h-3.5 w-3.5 shrink-0 ${inst.streak > 0 ? 'text-warning' : 'text-sell'}`} />
                            <span className={`text-xs font-semibold ${inst.streak > 0 ? 'text-warning' : 'text-sell'}`}>
                                {Math.abs(inst.streak)}-day {inst.streak > 0 ? 'buying' : 'selling'} streak
                            </span>
                            <span className="text-[10px] text-slate-500 ml-auto">blended weight</span>
                        </div>
                    )}
                    <p className="text-[11px] text-slate-500 mt-3">
                        Change in blended weight over each window. {sig.label === 'Selling starting'
                            ? 'Bought over the month/week but being sold today — distribution may be starting.'
                            : sig.label === 'Bottoming?'
                                ? 'Sold over the month but being bought recently — may be turning.'
                                : sig.label === 'Accumulating'
                                    ? 'Bought across every horizon — sustained accumulation.'
                                    : 'Sold across every horizon — sustained distribution.'}
                    </p>
                </div>
            </div>

            {/* Holders */}
            <div className="bg-surface border border-rule rounded-xl shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-rule">
                    <h2 className="text-sm font-black tracking-tight">Who holds it</h2>
                </div>
                {(() => {
                    const holderColumns: DataTableColumn[] = [
                        { key: 'fund', header: 'Fund' },
                        { key: 'provider', header: 'Provider' },
                        { key: 'shares', header: 'Shares', align: 'right' },
                        { key: 'weight', header: 'Weight', align: 'right' },
                        { key: 'change', header: 'Δ today', align: 'right' },
                    ];
                    const rows: DataTableRow[] = equityHolders.map((h) => {
                        const exp = fundExposure(h.aum ?? FUND_AUM[h.fund], h.weight);
                        const d = changeByFund.get(h.fund) ?? 0;
                        const ct = changeTypeByFund.get(h.fund);
                        return {
                            key: h.fund,
                            cells: {
                                fund: <Link href={`/fund/${h.fund}`} className="font-mono font-bold text-equity hover:underline">{h.fund}</Link>,
                                provider: <span className="text-slate-400">{h.provider}</span>,
                                shares: <span className="font-mono text-slate-500">{h.shares == null ? '—' : Math.round(h.shares).toLocaleString()}</span>,
                                weight: (
                                    <>
                                        <div className="font-mono text-slate-300">{h.weight.toFixed(3)}%</div>
                                        {exp && <div className="text-[10px] text-slate-600 font-mono tabular-nums">{exp}</div>}
                                    </>
                                ),
                                change: (
                                    <div className={`inline-flex items-center justify-end gap-1.5 font-mono ${d > 0 ? 'text-buy' : d < 0 ? 'text-sell' : 'text-slate-600'}`}>
                                        {ct === 'NEW' && (
                                            <span className="text-[9px] font-bold px-1 rounded border border-buy/30 bg-buy/10 text-buy">NEW</span>
                                        )}
                                        {ct === 'REMOVED' && (
                                            <span className="text-[9px] font-bold px-1 rounded border border-sell/30 bg-sell/10 text-sell">EXIT</span>
                                        )}
                                        {d !== 0 ? `${d > 0 ? '+' : ''}${d.toFixed(3)}%` : '—'}
                                    </div>
                                ),
                            },
                        };
                    });
                    return (
                        <DataTable
                            columns={holderColumns}
                            rows={rows}
                            emptyMessage="No equity holders."
                            className="border-0"
                            wrapperClassName="rounded-none border-0"
                        />
                    );
                })()}
            </div>

            {/* Option positions — income funds writing options against this ticker */}
            {optionHolders.length > 0 && (
                <div className="bg-surface border border-rule rounded-xl shadow-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-rule">
                        <h2 className="text-sm font-black tracking-tight">Option positions on it</h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            {optionHolders.length} live leg{optionHolders.length === 1 ? '' : 's'} from income funds — excluded from the institutional blend above. Negative contracts are written; a long call and a written put at the same strike together are synthetic stock, not two trades. Expired contracts are hidden.
                        </p>
                    </div>
                    {(() => {
                        const optionColumns: DataTableColumn[] = [
                            { key: 'fund', header: 'Fund' },
                            { key: 'provider', header: 'Provider' },
                            { key: 'type', header: 'Type' },
                            { key: 'contracts', header: 'Contracts', align: 'right' },
                            { key: 'strike', header: 'Strike', align: 'right' },
                            { key: 'expiry', header: 'Expiry', align: 'right' },
                            { key: 'weight', header: 'Wt in fund', align: 'right' },
                        ];
                        const rows: DataTableRow[] = optionHolders.map((h, i) => {
                            const optType = h.optionDetails?.type?.toLowerCase() ?? '';
                            const isCall = optType.startsWith('c');
                            const isPut = optType.startsWith('p');
                            const strategy = isCall ? 'Covered Call' : isPut ? 'Cash-Secured Put' : (h.optionDetails?.type ?? '—');
                            return {
                                key: `${h.fund}-${h.optionDetails?.strike ?? ''}-${h.optionDetails?.expiry ?? ''}-${i}`,
                                cells: {
                                    fund: (
                                        <span>
                                            <Link href={`/fund/${h.fund}`} className="font-mono font-bold text-equity hover:underline">{h.fund}</Link>
                                            {h.stale && h.fileDate && (
                                                <span className="block text-[10px] text-warning" title="The issuer hasn't published newer holdings">
                                                    stale · {h.fileDate}
                                                </span>
                                            )}
                                        </span>
                                    ),
                                    contracts: (() => {
                                        const c = h.optionDetails?.contracts ?? h.shares;
                                        return (
                                            <span className={`font-mono ${c < 0 ? 'text-warning' : 'text-buy'}`} title={c < 0 ? 'Written (short)' : 'Bought (long)'}>
                                                {c > 0 ? '+' : ''}{Math.round(c).toLocaleString('en-US')}
                                            </span>
                                        );
                                    })(),
                                    provider: <span className="text-slate-400">{h.provider}</span>,
                                    type: (
                                        <span
                                            title={strategy}
                                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                                isCall
                                                    ? 'border-warning/30 bg-warning/10 text-warning'
                                                    : isPut
                                                        ? 'border-equity/30 bg-equity/10 text-equity'
                                                        : 'border-rule-strong bg-surface-elevated text-slate-400'
                                            }`}
                                        >
                                            {isCall ? 'CALL' : isPut ? 'PUT' : (h.optionDetails?.type ?? '?')}
                                        </span>
                                    ),
                                    strike: (
                                        <span className="font-mono text-slate-300">
                                            {h.optionDetails?.strike != null ? `$${h.optionDetails.strike.toFixed(2)}` : '—'}
                                            {h.optionDetails?.isFlex && (
                                                <span className="ml-1 text-[9px] px-1 rounded border border-rule text-slate-500" title="FLEX contract — customised, not exchange-listed">FLEX</span>
                                            )}
                                        </span>
                                    ),
                                    expiry: <span className="font-mono text-slate-400 text-xs">{h.optionDetails?.expiry ? formatExpiry(h.optionDetails.expiry) : '—'}</span>,
                                    weight: <span className="font-mono text-slate-300">{h.weight.toFixed(2)}%</span>,
                                },
                            };
                        });
                        return (
                            <DataTable
                                columns={optionColumns}
                                rows={rows}
                                emptyMessage="No option positions."
                                className="border-0"
                                wrapperClassName="rounded-none border-0"
                            />
                        );
                    })()}
                </div>
            )}

            {/* ── Live options flow panel (stock_flow_panel) ── */}
            <div
                className="rounded-xl border border-tm-gold/35 overflow-hidden"
                style={{ background: 'linear-gradient(90deg,#111827,#14161c 60%,#18160f)' }}
            >
                {/* Panel header */}
                <div className="px-4 py-3 border-b border-rule flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <TMMark size={22} />
                        <div className="min-w-0">
                            <h2 className="text-sm font-black leading-tight">
                                {ticker} options flow today{' '}
                                <span className="text-tm-gold-bright">· live on TraderMatrix</span>
                            </h2>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                                The fund data above is end-of-day. This is what traders are doing with {ticker} right now.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Blurred, always. TickerTrace never shows flow: these tiles are meaningless
                    filler (aria-hidden) that tease what TraderMatrix has. */}
                <div className="relative">
                    <div aria-hidden="true" className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y divide-rule select-none">
                        {[0, 1, 2, 3].map(i => (
                            <div key={i} className="px-4 py-3 flex flex-col gap-1.5 blur-[4px]">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold px-2 py-px rounded-full border border-tm-gold/40 text-tm-gold-bright whitespace-nowrap">XXXXX</span>
                                    <span className="text-[11px] text-slate-500 font-mono">xx:xx ET</span>
                                </div>
                                <div className="font-mono text-[13px] text-slate-200">Xx/Xx XxxC · $x.xM</div>
                            </div>
                        ))}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="inline-flex items-center gap-2 rounded-full border border-tm-gold/40 bg-canvas/80 px-3 py-1.5 text-xs font-bold text-tm-gold-bright">
                            <Lock className="h-3.5 w-3.5" /> See {ticker} flow on TraderMatrix
                        </span>
                    </div>
                </div>

                {/* Panel footer */}
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-400 flex-1 min-w-0">
                        Unusual prints, strikes, size and TraderLady&apos;s read are all on TraderMatrix.
                    </p>
                    <TMLink
                        placement="stock_flow_panel"
                        ticker={ticker}
                        className="shrink-0 inline-flex items-center px-4 py-2.5 rounded-xl font-extrabold text-[13px] text-canvas transition-colors hover:opacity-90"
                        style={{ background: '#e0b03a' }}
                    >
                        Unlock {ticker} flow →
                    </TMLink>
                </div>
            </div>

            {/* Alert upsell (stock_alert) */}
            <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-tm-gold/30 bg-tm-gold/5 p-4">
                <svg
                    viewBox="0 0 24 24" fill="none" stroke="#e0b03a" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                    className="w-[22px] h-[22px] shrink-0"
                    aria-hidden="true"
                >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    <path d="M12 2v1" />
                </svg>
                <div className="flex-1 min-w-[200px]">
                    <div className="text-sm font-bold text-white">Get pinged the next time a sweep hits {ticker}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                        TickerTrace tracks the funds daily. TraderMatrix sends you an alert the minute the options flow moves.
                    </div>
                </div>
                <TMLink
                    placement="stock_alert"
                    ticker={ticker}
                    className="inline-flex items-center min-h-11 md:min-h-0 px-4 py-2 rounded-xl border border-tm-gold/50 text-tm-gold-bright text-[13px] font-extrabold whitespace-nowrap hover:border-tm-gold hover:text-white transition-colors"
                >
                    Set {ticker} alert →
                </TMLink>
            </div>

            {/* Share row */}
            <div className="space-y-2">
                <p className="text-[11px] text-slate-500 text-center">Share {ticker} fund flow</p>
                <ShareButtons
                    url={shareUrl}
                    tweet={shareTweet}
                    redditTitle={shareRedditTitle}
                    redditText={shareRedditText}
                    size="sm"
                    align="center"
                />
            </div>
        </div>
    );
}
