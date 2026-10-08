'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import {
    Award, Target, Clock, Layers, RefreshCw, DollarSign,
    Shield, PieChart, ArrowLeft, ChevronDown, ChevronUp, Info,
    TrendingUp, ArrowRight, AlertTriangle, Share2, Copy, Check, ExternalLink
} from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/data-table';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.tickertrace.pro';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FundSummary {
    fund: string;
    grade: string;
    compositeScore: number | null;
    optionsCount: number;
    historyDepth: number;
    peerGroup: string;
    hedgingMandated: boolean;
    strategyDescription: string;
    strikeSelection: { score: number | null; avgMoneyness: number | null; writtenCount: number };
    dteManagement: { score: number | null; avgDTE: number | null; gammaRiskFlag: boolean };
    spreadEfficiency: { score: number | null; spreadCount: number; coveredCount: number; nakedCount: number; spreadRatio: number | null };
    rollBehavior: { score: number | null; rollsDetected: number; avgRollDTE: number | null };
    premiumCapture: { score: number | null; netPremium: number; hedgeCostRatio: number | null };
    hedgeRatio: { score: number | null; coverageRatio: number | null; netPortfolioDelta: number | null };
    concentrationRisk: { score: number | null; hhi: number | null; uniqueUnderlyings: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const gradeColors: Record<string, string> = {
    'A': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    'B': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    'C': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    'D': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'F': 'bg-red-500/20 text-red-400 border-red-500/30',
    'N/A': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

function scoreColor(score: number | null): string {
    if (score === null) return 'text-slate-500';
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    if (score >= 40) return 'text-orange-400';
    return 'text-red-400';
}

function scoreBg(score: number | null): string {
    if (score === null) return 'bg-slate-800/50';
    if (score >= 80) return 'bg-emerald-500/10';
    if (score >= 60) return 'bg-amber-500/10';
    if (score >= 40) return 'bg-orange-500/10';
    return 'bg-red-500/10';
}

function ScoreCell({ score }: { score: number | null }) {
    if (score === null) return <span className="text-slate-600 text-xs">—</span>;
    return (
        <span className={`font-mono font-bold text-sm ${scoreColor(score)}`}>
            {Math.round(score)}
        </span>
    );
}

// ─── Methodology ─────────────────────────────────────────────────────────────

const METHODOLOGY = [
    {
        title: 'Strike Selection',
        icon: <Target className="h-4 w-4 text-equity" />,
        text: 'Evaluates WHERE options are sold relative to the underlying price. Calls and puts are scored separately — optimal zones differ (3-8% OTM for calls, 2-5% OTM for puts). Each fund is scored against its own prospectus-calibrated optimal moneyness band, so ATM-focused funds aren\'t penalized for selling near-the-money. Weighted by notional exposure (larger positions count more).',
    },
    {
        title: 'DTE Management',
        icon: <Clock className="h-4 w-4 text-warning" />,
        text: 'Scores WHEN options expire. Theta (time decay) accelerates non-linearly below 21 DTE. The sweet spot depends on the fund\'s write cycle — weekly writers sit around 3 DTE, two-week cycles around 6, monthly writers 14-21. The cycle label next to each fund (weekly / biweekly / monthly) is measured from its actual expiries, not a prospectus guess. Synthetic-stock legs (long call + short put used to hold the underlying) and expired contracts are excluded. Includes a consistency bonus for systematic execution (tight DTE clustering) and gamma risk penalties for very short DTE when it\'s off-strategy.',
    },
    {
        title: 'Spread Efficiency',
        icon: <Layers className="h-4 w-4 text-buy" />,
        text: 'Evaluates HOW risk is managed. Detects defined-risk spreads (same underlying, same expiry, opposite positions, different strikes). Recognizes equity-covered calls as implicitly hedged. Scores on risk/reward ratio (premium ÷ max loss) — a $5-wide spread collecting $3 scores much higher than one collecting $0.50.',
    },
    {
        title: 'Roll Behavior',
        icon: <RefreshCw className="h-4 w-4 text-meta" />,
        text: 'Tracks position MANAGEMENT over time by comparing daily snapshots. Detects rolls (same underlying + type, changed expiry). Scores roll timing (ideal: 3-7 DTE remaining) and tracks roll direction (up = bullish adjustment, down = defensive).',
    },
    {
        title: 'Premium Capture',
        icon: <DollarSign className="h-4 w-4 text-equity" />,
        text: 'Measures INCOME GENERATION efficiency. Reports net premium (written minus bought), premium as a percentage of NAV, and the hedge cost ratio (how much of gross premium is spent on protection). Higher NAV yield with moderate hedge cost scores best.',
    },
    {
        title: 'Hedge Ratio',
        icon: <Shield className="h-4 w-4 text-meta" />,
        text: 'Scores COVERAGE using Black-Scholes approximate delta (σ=30%, r=5%). For each underlying with written options, checks for stock (held outright or via a synthetic long) or protective long options. Only stock the options are written on counts toward delta — cash and T-bills do not. Lower net directional delta and higher coverage = better hedged. Funds where hedging is NOT mandated by prospectus get reduced weight for this metric.',
    },
    {
        title: 'Concentration Risk',
        icon: <PieChart className="h-4 w-4 text-[#f472b6]" />,
        text: 'Scores DIVERSIFICATION using a Herfindahl-Hirschman Index (HHI) across underlyings by notional value. Also flags expiry clustering where too many positions expire on a single date (correlated risk event). Lower HHI and more expiry diversification = better score.',
    },
    {
        title: 'Composite Grade',
        icon: <TrendingUp className="h-4 w-4 text-subtext" />,
        text: 'The final grade is a DYNAMIC weighted average — weights shift based on data confidence (more positions → higher weight) and risk signals (low hedge score → hedge metric weight increases). Each fund also has prospectus-calibrated weights (e.g., EGGS has 25% hedge weight because hedging is mandated; SLTY has 8% because it IS the hedge). Not arbitrary fixed weights.',
    },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EffectivenessPage() {
    const [funds, setFunds] = useState<FundSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [methodologyOpen, setMethodologyOpen] = useState(false);
    const [sortBy, setSortBy] = useState<string>('composite');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        fetch(`${API_BASE}/api/v1/fund-effectiveness`)
            .then(res => {
                if (!res.ok) throw new Error('Failed to load');
                return res.json();
            })
            .then(data => setFunds(data.funds || []))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    const sortedFunds = [...funds].sort((a, b) => {
        const getScore = (f: FundSummary, key: string): number => {
            switch (key) {
                case 'composite': return f.compositeScore ?? -1;
                case 'strike': return f.strikeSelection?.score ?? -1;
                case 'dte': return f.dteManagement?.score ?? -1;
                case 'spread': return f.spreadEfficiency?.score ?? -1;
                case 'roll': return f.rollBehavior?.score ?? -1;
                case 'premium': return f.premiumCapture?.score ?? -1;
                case 'hedge': return f.hedgeRatio?.score ?? -1;
                case 'concentration': return f.concentrationRisk?.score ?? -1;
                default: return f.compositeScore ?? -1;
            }
        };
        return getScore(b, sortBy) - getScore(a, sortBy);
    });

    const metrics = [
        { key: 'composite', label: 'Grade', shortLabel: 'Grade' },
        { key: 'strike', label: 'Strike', shortLabel: 'Strike' },
        { key: 'dte', label: 'DTE', shortLabel: 'DTE' },
        { key: 'spread', label: 'Spread', shortLabel: 'Spread' },
        { key: 'roll', label: 'Roll', shortLabel: 'Roll' },
        { key: 'premium', label: 'Premium', shortLabel: 'Prem.' },
        { key: 'hedge', label: 'Hedge', shortLabel: 'Hedge' },
        { key: 'concentration', label: 'Conc.', shortLabel: 'Conc.' },
    ];

    return (
        <div className="min-h-dvh bg-canvas text-white font-sans p-6">
            <div className="max-w-7xl mx-auto mb-6"><SiteNav /></div>
            {/* Header */}
            <div className="max-w-7xl mx-auto mb-8">
                <Link href="/dashboard" className="text-xs text-slate-500 hover:text-white transition-colors flex items-center gap-1 mb-4">
                    <ArrowLeft className="h-3 w-3" /> Back to Dashboard
                </Link>
                <div className="flex items-center gap-3 mb-2">
                    <Award className="h-8 w-8 text-meta" />
                    <h1 className="text-3xl font-black tracking-tight">Strategy Effectiveness</h1>
                </div>
                <p className="text-slate-400 max-w-2xl">
                    How well does each option-income ETF execute its stated strategy?
                    All {funds.length} funds scored side-by-side using prospectus-calibrated metrics.
                </p>

                {/* Share Bar */}
                {!loading && !error && funds.length > 0 && (
                    <div className="flex items-center gap-2 mt-4">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-1">Share</span>
                        <a
                            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                                `How effective are your option-income ETFs? ${funds.length} funds scored side-by-side on strike selection, DTE management, hedging, and more.\n\nFree institutional-grade analysis 👇`
                            )}&url=${encodeURIComponent('https://tickertrace.pro/effectiveness')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rule bg-surface hover:border-equity/40 hover:text-equity text-slate-400 text-xs transition-all duration-200"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Post on X
                        </a>
                        <a
                            href={`https://www.reddit.com/submit?url=${encodeURIComponent('https://tickertrace.pro/effectiveness')}&title=${encodeURIComponent(
                                `Free tool: Strategy effectiveness scores for ${funds.length} option-income ETFs (ULTY, KYLD, BLOX, etc.)`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rule bg-surface hover:border-[#f97316]/40 hover:text-[#f97316] text-slate-400 text-xs transition-all duration-200"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Reddit
                        </a>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText('https://tickertrace.pro/effectiveness');
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all duration-200 ${copied
                                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                                : 'border-rule bg-surface hover:border-slate-500 text-slate-400'
                                }`}
                        >
                            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copied ? 'Copied!' : 'Copy Link'}
                        </button>
                    </div>
                )}
            </div>

            {/* Loading / Error */}
            {loading && (
                <div className="max-w-7xl mx-auto text-center py-20">
                    <div className="animate-pulse text-slate-500">
                        <Award className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p className="text-sm">Analyzing all option-income funds…</p>
                    </div>
                </div>
            )}

            {error && (
                <div className="max-w-7xl mx-auto text-center py-20 text-red-400">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-3" />
                    <p className="text-sm">{error}</p>
                </div>
            )}

            {!loading && !error && funds.length > 0 && (
                <div className="max-w-7xl mx-auto space-y-8">
                    {/* ─── Comparison Table ─── */}
                    <div className="bg-surface border border-rule rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-rule flex items-center justify-between">
                            <h2 className="font-bold text-sm flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-equity" />
                                Side-by-Side Comparison
                            </h2>
                            <span className="text-[10px] text-slate-500">Click column headers to sort</span>
                        </div>
                        {(() => {
                            // Sort stays externally driven by `sortBy` (clicking a metric
                            // header re-sorts both this table AND the strategy cards below
                            // it) — so these columns render their own clickable header and
                            // never mark themselves `sortable`, skipping DataTable's own
                            // sort mechanism entirely. Only structure/empty-state/mobile-
                            // priority come from DataTable here.
                            const metricAccessor: Record<string, (f: FundSummary) => { score: number | null }> = {
                                strike: f => f.strikeSelection,
                                dte: f => f.dteManagement,
                                spread: f => f.spreadEfficiency,
                                roll: f => f.rollBehavior,
                                premium: f => f.premiumCapture,
                                hedge: f => f.hedgeRatio,
                                concentration: f => f.concentrationRisk,
                            };
                            const otherMetrics = metrics.filter(m => m.key !== 'composite');
                            // No mobile priority previously existed on this table (10
                            // columns, none hidden). Fund + Grade are load-bearing at
                            // 375px; Strategy blurb and the four "how" metrics return at
                            // md/lg, the three deepest metrics at xl.
                            const columns: DataTableColumn[] = [
                                { key: 'fund', header: 'Fund' },
                                { key: 'strategy', header: 'Strategy', mobilePriority: 'md' },
                                {
                                    key: 'composite',
                                    header: (
                                        <span
                                            onClick={() => setSortBy('composite')}
                                            className={`cursor-pointer hover:text-white transition-colors ${sortBy === 'composite' ? 'text-equity' : ''}`}
                                        >
                                            Grade{sortBy === 'composite' && <span className="ml-0.5">▼</span>}
                                        </span>
                                    ),
                                    align: 'center',
                                },
                                ...otherMetrics.map((m, idx): DataTableColumn => ({
                                    key: m.key,
                                    header: (
                                        <span
                                            onClick={() => setSortBy(m.key)}
                                            className={`cursor-pointer hover:text-white transition-colors ${sortBy === m.key ? 'text-equity' : ''}`}
                                        >
                                            {m.shortLabel}{sortBy === m.key && <span className="ml-0.5">▼</span>}
                                        </span>
                                    ),
                                    align: 'center',
                                    mobilePriority: idx < 4 ? 'lg' : 'xl',
                                })),
                            ];
                            const rows: DataTableRow[] = sortedFunds.map((f) => {
                                const cellClassName: Record<string, string | undefined> = {};
                                const cells: Record<string, ReactNode> = {
                                    fund: (
                                        <>
                                            <Link
                                                href={`/fund/${f.fund}`}
                                                className="font-mono font-bold text-equity hover:underline flex items-center gap-1"
                                            >
                                                {f.fund}
                                                <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                                            </Link>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className="text-[9px] text-slate-500">{f.peerGroup}</span>
                                                {f.hedgingMandated && (
                                                    <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                                                        hedged
                                                    </span>
                                                )}
                                            </div>
                                        </>
                                    ),
                                    strategy: (
                                        <span className="text-[10px] text-slate-400 line-clamp-2 max-w-[180px]">
                                            {f.strategyDescription.split('.')[0]}.
                                        </span>
                                    ),
                                    composite: (
                                        <div className="flex flex-col items-center gap-0.5">
                                            <span className={`text-lg font-black px-2 py-0.5 rounded-md border ${gradeColors[f.grade] || gradeColors['N/A']}`}>
                                                {f.grade}
                                            </span>
                                            <span className={`font-mono text-xs ${scoreColor(f.compositeScore)}`}>
                                                {f.compositeScore ?? '—'}
                                            </span>
                                        </div>
                                    ),
                                };
                                for (const m of otherMetrics) {
                                    const score = metricAccessor[m.key](f).score;
                                    cells[m.key] = <ScoreCell score={score} />;
                                    cellClassName[m.key] = scoreBg(score);
                                }
                                return { key: f.fund, cells, cellClassName };
                            });
                            return (
                                <DataTable
                                    columns={columns}
                                    rows={rows}
                                    emptyMessage="No funds scored yet."
                                    wrapperClassName="rounded-none border-0"
                                    className="border-0"
                                />
                            );
                        })()}
                    </div>

                    {/* ─── Fund Strategy Cards ─── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {sortedFunds.map(f => (
                            <Link
                                key={f.fund}
                                href={`/fund/${f.fund}`}
                                className="bg-surface border border-rule rounded-xl p-5 hover:border-[#2a3a52] transition-colors group"
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-black text-lg text-equity">{f.fund}</span>
                                        <span className="text-[9px] text-slate-500 uppercase">{f.peerGroup}</span>
                                    </div>
                                    <span className={`text-2xl font-black px-2.5 py-0.5 rounded-lg border ${gradeColors[f.grade] || gradeColors['N/A']}`}>
                                        {f.grade}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed mb-3 line-clamp-2">
                                    {f.strategyDescription}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {[
                                        { label: 'Strike', score: f.strikeSelection.score },
                                        { label: 'DTE', score: f.dteManagement.score },
                                        { label: 'Spread', score: f.spreadEfficiency.score },
                                        { label: 'Hedge', score: f.hedgeRatio.score },
                                    ].map(m => (
                                        <div key={m.label} className="text-center">
                                            <div className={`font-mono text-sm font-bold ${scoreColor(m.score)}`}>
                                                {m.score !== null ? Math.round(m.score) : '—'}
                                            </div>
                                            <div className="text-[9px] text-slate-500">{m.label}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 text-[10px] text-slate-500 flex items-center justify-between">
                                    <span>{f.optionsCount} positions · {f.historyDepth} days</span>
                                    <span className="text-equity opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                                        View detail <ArrowRight className="h-3 w-3" />
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>

                    {/* ─── Methodology ─── */}
                    <div className="bg-surface border border-rule rounded-2xl overflow-hidden">
                        <button
                            onClick={() => setMethodologyOpen(!methodologyOpen)}
                            className="w-full px-6 py-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
                        >
                            <h2 className="font-bold text-sm flex items-center gap-2">
                                <Info className="h-4 w-4 text-slate-400" />
                                Scoring Methodology
                            </h2>
                            {methodologyOpen
                                ? <ChevronUp className="h-4 w-4 text-slate-400" />
                                : <ChevronDown className="h-4 w-4 text-slate-400" />
                            }
                        </button>
                        {methodologyOpen && (
                            <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {METHODOLOGY.map(m => (
                                    <div key={m.title} className="bg-surface-alt border border-surface-elevated rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            {m.icon}
                                            <h3 className="font-bold text-sm text-white">{m.title}</h3>
                                        </div>
                                        <p className="text-xs text-slate-400 leading-relaxed">{m.text}</p>
                                    </div>
                                ))}
                                <div className="md:col-span-2 bg-surface-alt border border-surface-elevated rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertTriangle className="h-4 w-4 text-slate-500" />
                                        <h3 className="font-bold text-sm text-slate-300">Limitations & Disclaimers</h3>
                                    </div>
                                    <div className="text-xs text-slate-500 space-y-1.5 leading-relaxed">
                                        <p>• Analysis is based on daily holdings snapshots, not live trade data. Actual Greeks, bid-ask spreads, and real-time implied volatility are not available.</p>
                                        <p>• Black-Scholes approximations use a fixed σ=30% and r=5%. Actual implied volatility varies by underlying, strike, and expiry.</p>
                                        <p>• Scores improve with more historical data. Funds with fewer days of history may have less reliable roll behavior and trend signals.</p>
                                        <p>• This is not investment advice. Scores reflect strategy execution quality, not expected returns or risk-adjusted performance.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
