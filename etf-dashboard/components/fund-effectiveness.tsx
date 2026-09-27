'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
    Target, Clock, Layers, RefreshCw, DollarSign, Award,
    Shield, TrendingUp, AlertTriangle, Activity, PieChart, Info, ChevronDown, ChevronUp, ArrowRight
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StrikeSelection {
    avgMoneyness: number | null;
    callAvgMoneyness: number | null;
    putAvgMoneyness: number | null;
    distribution: { deepOTM: number; slightlyOTM: number; atm: number; itm: number };
    writtenCount: number;
    callCount: number;
    putCount: number;
    score: number | null;
}

interface DTEManagement {
    avgDTE: number | null;
    distribution: { weekly: number; biweekly: number; monthly: number; longDated: number };
    consistency: number | null;
    gammaRiskFlag: boolean;
    score: number | null;
}

interface SpreadEfficiency {
    spreadCount: number;
    nakedCount: number;
    coveredCount: number;
    spreadRatio: number | null;
    avgRiskReward: number | null;
    avgWidthPct: number | null;
    spreads: { underlying: string; type: string; shortStrike: number; longStrike: number; width: number; widthPct: number; riskReward: number }[];
    score: number | null;
}

interface RollBehavior {
    rollsDetected: number;
    avgRollDTE: number | null;
    strikeAdjustments: { rolledUp: number; rolledDown: number; same: number };
    weekendGapRolls: number;
    recentRolls: { underlying: string; type: string; fromExpiry: string; toExpiry: string; oldStrike: number; newStrike: number; rollDTE: number | null; weekendGap: boolean }[];
    score: number | null;
}

interface PremiumCapture {
    totalPremiumWritten: number;
    totalPremiumBought: number;
    netPremium: number;
    premiumAsPercentNAV: number | null;
    hedgeCostRatio: number | null;
    premiumDensity: number | null;
    positionsWritten: number;
    positionsBought: number;
    score: number | null;
}

interface HedgeRatio {
    netPortfolioDelta: number | null;
    coverageRatio: number | null;
    collarCount: number;
    coveredCallCount: number;
    avgAbsDelta: number | null;
    score: number | null;
}

interface ConcentrationRisk {
    hhi: number | null;
    uniqueUnderlyings: number;
    topExpiryConcentration: number | null;
    expiryCount: number;
    score: number | null;
}

interface EffectivenessData {
    fund: string;
    asOfDate: string;
    dataStale?: boolean;
    staleSnapshots?: number;
    historyDepth: number;
    optionsCount: number;
    netAssets: number | null;
    grade: string;
    compositeScore: number | null;
    weights: Record<string, number>;
    strategyDescription: string;
    peerGroup: string;
    hedgingMandated: boolean;
    strikeSelection: StrikeSelection;
    dteManagement: DTEManagement;
    spreadEfficiency: SpreadEfficiency;
    rollBehavior: RollBehavior;
    premiumCapture: PremiumCapture;
    hedgeRatio: HedgeRatio;
    concentrationRisk: ConcentrationRisk;
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
    if (score === null) return 'bg-slate-500/10';
    if (score >= 80) return 'bg-emerald-500/10';
    if (score >= 60) return 'bg-amber-500/10';
    if (score >= 40) return 'bg-orange-500/10';
    return 'bg-red-500/10';
}

function Tooltip({ text }: { text: string }) {
    return (
        <span className="group relative inline-flex ml-1 cursor-help">
            <Info className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors" />
            <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 p-2 text-[10px] leading-tight text-slate-200 bg-surface-alt border border-surface-elevated rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                {text}
            </span>
        </span>
    );
}

function MiniBar({ segments, colors }: { segments: { label: string; value: number }[]; colors: string[] }) {
    const total = segments.reduce((s, seg) => s + seg.value, 0);
    if (total === 0) return <span className="text-xs text-slate-600">No data</span>;

    return (
        <div className="space-y-1.5">
            <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-elevated">
                {segments.map((seg, i) => (
                    seg.value > 0 && (
                        <div
                            key={seg.label}
                            className={`${colors[i]} transition-all`}
                            style={{ width: `${(seg.value / total) * 100}%` }}
                            title={`${seg.label}: ${seg.value}`}
                        />
                    )
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {segments.map((seg, i) => (
                    <span key={seg.label} className="text-[10px] text-slate-500 flex items-center gap-1">
                        <span className={`inline-block w-2 h-2 rounded-sm ${colors[i]}`} />
                        {seg.label}: {seg.value}
                    </span>
                ))}
            </div>
        </div>
    );
}

function MetricCard({ title, icon, score, tooltip, children }: {
    title: string;
    icon: React.ReactNode;
    score: number | null;
    tooltip: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`rounded-lg border border-surface-elevated ${scoreBg(score)} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                    {icon}
                    {title}
                    <Tooltip text={tooltip} />
                </div>
                {score !== null && (
                    <span className={`font-mono font-bold text-sm ${scoreColor(score)}`}>
                        {score}/100
                    </span>
                )}
            </div>
            {children}
        </div>
    );
}

function formatDollar(n: number): string {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
    return (
        <div className="flex justify-between">
            <span>{label}</span>
            <span className={`font-mono ${valueClass || 'text-white'}`}>{value}</span>
        </div>
    );
}

// ─── Methodology Section ─────────────────────────────────────────────────────

function MethodologySection() {
    const [open, setOpen] = useState(false);
    return (
        <div className="mt-3 border-t border-surface-elevated pt-3">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors w-full"
            >
                <Info className="h-3 w-3" />
                <span className="font-medium">Scoring Methodology</span>
                {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {open && (
                <div className="mt-2 text-[10px] text-slate-500 space-y-2 leading-relaxed">
                    <p><strong className="text-slate-400">Black-Scholes Greeks:</strong> Delta and Gamma are approximated using the Black-Scholes model (σ=30%, r=5%) for hedge ratio analysis. These are estimates — actual Greeks depend on real-time IV.</p>
                    <p><strong className="text-slate-400">Notional Weighting:</strong> All scores are weighted by notional exposure (|contracts| × underlying price × 100) so large positions count proportionally more than small ones.</p>
                    <p><strong className="text-slate-400">Continuous Scoring:</strong> All metrics use smooth Gaussian, sigmoid, or asymptotic curves — no step-function cliffs. A DTE of 6.9 and 7.0 score nearly identically.</p>
                    <p><strong className="text-slate-400">Dynamic Composite:</strong> Final grade weights adjust based on data confidence (more positions → higher weight for that metric) and risk signals (low hedge ratio → hedge metric weight increases).</p>
                    <p><strong className="text-slate-400">Limitations:</strong> Analysis is based on daily holdings snapshots, not live trade data. Actual Greeks, bid-ask spreads, and real-time IV are not available. Scores improve with more historical data.</p>
                </div>
            )}
        </div>
    );
}

// ─── Component ───────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.tickertrace.pro';

export function FundEffectiveness({ fund }: { fund: string }) {
    const [data, setData] = useState<EffectivenessData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch(`${API_BASE}/api/v1/fund-effectiveness/${fund}`)
            .then(res => {
                if (!res.ok) throw new Error(`No effectiveness data`);
                return res.json();
            })
            .then(setData)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [fund]);

    if (loading) {
        return (
            <Card className="bg-surface border-rule mt-6 animate-pulse">
                <CardHeader className="pb-3 border-b border-rule">
                    <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                        <Award className="h-5 w-5 text-meta" /> Strategy Effectiveness
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                    <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
                        Analyzing option strategy effectiveness…
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error || !data) return null;

    const { strikeSelection, dteManagement, spreadEfficiency, rollBehavior, premiumCapture, hedgeRatio, concentrationRisk } = data;

    return (
        <Card className="bg-surface border-rule mt-6">
            <CardHeader className="pb-3 border-b border-rule">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                    <Award className="h-5 w-5 text-meta" /> Strategy Effectiveness
                    <Tooltip text="Institutional-grade analysis of how effectively this fund executes its options strategy. Scores use Black-Scholes approximate Greeks, notional weighting, and continuous non-linear scoring functions." />
                    <span className="ml-auto flex items-center gap-2">
                        <span className="text-xs font-normal text-slate-500">
                            {data.optionsCount} positions · {data.historyDepth} days · {data.peerGroup}
                        </span>
                        {data.dataStale && (
                            <Badge
                                variant="outline"
                                title={`No option legs in the latest ${data.staleSnapshots} snapshot(s) — likely a scraper gap. Showing the most recent day with data (${data.asOfDate}).`}
                                className="text-[9px] border-amber-500/40 text-amber-400 cursor-help"
                            >
                                as of {data.asOfDate}
                            </Badge>
                        )}
                        <Badge
                            variant="outline"
                            className={`text-xl font-black px-3 py-0.5 border ${gradeColors[data.grade] || gradeColors['N/A']}`}
                        >
                            {data.grade}
                        </Badge>
                        {data.compositeScore !== null && (
                            <span className={`font-mono text-sm font-bold ${scoreColor(data.compositeScore)}`}>
                                {data.compositeScore}
                            </span>
                        )}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
                {/* Strategy context from prospectus */}
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                    <strong className="text-slate-300">Strategy:</strong> {data.strategyDescription}
                    {data.hedgingMandated && (
                        <Badge variant="outline" className="ml-2 text-[9px] border-emerald-500/30 text-emerald-400">Hedging Mandated</Badge>
                    )}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">

                    {/* ─── Hedge Ratio (most important) ─── */}
                    <MetricCard
                        title="Hedge Ratio"
                        icon={<Shield className="h-3.5 w-3.5 text-meta" />}
                        score={hedgeRatio.score}
                        tooltip="Measures directional risk management using Black-Scholes approximate delta. Higher coverage ratio and lower net delta = better hedged. Stock held outright or via a synthetic long (long call + short put) covers written calls; a collar is stock + written call + long put."
                    >
                        <div className="text-xs text-slate-400 space-y-1">
                            <StatRow
                                label="Coverage"
                                value={hedgeRatio.coverageRatio !== null ? `${(hedgeRatio.coverageRatio * 100).toFixed(0)}%` : '—'}
                            />
                            <StatRow
                                label="Net Δ (portfolio)"
                                value={hedgeRatio.netPortfolioDelta !== null ? hedgeRatio.netPortfolioDelta.toLocaleString() : '—'}
                                valueClass={hedgeRatio.netPortfolioDelta !== null
                                    ? Math.abs(hedgeRatio.netPortfolioDelta) < 10000 ? 'text-emerald-400' : 'text-orange-400'
                                    : 'text-white'}
                            />
                            <StatRow label="Covered Calls" value={`${hedgeRatio.coveredCallCount}`} />
                            <StatRow label="Collars" value={`${hedgeRatio.collarCount}`} />
                        </div>
                    </MetricCard>

                    {/* ─── Strike Selection ─── */}
                    <MetricCard
                        title="Strike Selection"
                        icon={<Target className="h-3.5 w-3.5 text-equity" />}
                        score={strikeSelection.score}
                        tooltip="Evaluates WHERE options are sold relative to the underlying. Calls and puts scored separately — optimal is 3-8% OTM for calls, 2-5% OTM for puts. Weighted by notional exposure."
                    >
                        <div className="text-xs text-slate-400 space-y-1">
                            <StatRow
                                label="Avg Moneyness"
                                value={strikeSelection.avgMoneyness !== null ? `${(strikeSelection.avgMoneyness * 100).toFixed(1)}%` : '—'}
                            />
                            {strikeSelection.callAvgMoneyness !== null && (
                                <StatRow
                                    label={`Calls (${strikeSelection.callCount})`}
                                    value={`${(strikeSelection.callAvgMoneyness * 100).toFixed(1)}%`}
                                />
                            )}
                            {strikeSelection.putAvgMoneyness !== null && (
                                <StatRow
                                    label={`Puts (${strikeSelection.putCount})`}
                                    value={`${(strikeSelection.putAvgMoneyness * 100).toFixed(1)}%`}
                                />
                            )}
                        </div>
                        <MiniBar
                            segments={[
                                { label: 'Deep OTM', value: strikeSelection.distribution.deepOTM },
                                { label: 'Slight OTM', value: strikeSelection.distribution.slightlyOTM },
                                { label: 'ATM', value: strikeSelection.distribution.atm },
                                { label: 'ITM', value: strikeSelection.distribution.itm },
                            ]}
                            colors={['bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-red-500']}
                        />
                    </MetricCard>

                    {/* ─── Premium Capture ─── */}
                    <MetricCard
                        title="Premium Capture"
                        icon={<DollarSign className="h-3.5 w-3.5 text-equity" />}
                        score={premiumCapture.score}
                        tooltip="Measures income generation efficiency. Tracks gross premium written, cost of hedges (long options), net premium retained, and hedge cost ratio. Higher NAV yield with moderate hedge cost = best score."
                    >
                        <div className="text-xs text-slate-400 space-y-1">
                            <StatRow
                                label="Net Premium"
                                value={formatDollar(premiumCapture.netPremium)}
                                valueClass={premiumCapture.netPremium >= 0 ? 'text-emerald-400' : 'text-red-400'}
                            />
                            {premiumCapture.premiumAsPercentNAV !== null && (
                                <StatRow label="% of NAV" value={`${premiumCapture.premiumAsPercentNAV}%`} />
                            )}
                            {premiumCapture.hedgeCostRatio !== null && (
                                <StatRow
                                    label="Hedge Cost"
                                    value={`${(premiumCapture.hedgeCostRatio * 100).toFixed(0)}% of gross`}
                                />
                            )}
                            <StatRow label="Written / Bought" value={`${premiumCapture.positionsWritten} / ${premiumCapture.positionsBought}`} />
                        </div>
                    </MetricCard>

                    {/* ─── Spread Efficiency ─── */}
                    <MetricCard
                        title="Spread Efficiency"
                        icon={<Layers className="h-3.5 w-3.5 text-buy" />}
                        score={spreadEfficiency.score}
                        tooltip="Evaluates risk management structures. Counts defined-risk spreads, equity-covered calls, and naked positions. Scores on hedge ratio plus risk/reward quality of spreads. Covered calls are recognized as implicitly hedged."
                    >
                        <div className="text-xs text-slate-400 space-y-1">
                            <StatRow
                                label="Hedged Ratio"
                                value={spreadEfficiency.spreadRatio !== null ? `${(spreadEfficiency.spreadRatio * 100).toFixed(0)}%` : '—'}
                            />
                            {spreadEfficiency.avgRiskReward !== null && (
                                <StatRow label="Avg R:R" value={`${(spreadEfficiency.avgRiskReward * 100).toFixed(0)}%`} />
                            )}
                        </div>
                        <MiniBar
                            segments={[
                                { label: 'Spreads', value: spreadEfficiency.spreadCount },
                                { label: 'Covered', value: spreadEfficiency.coveredCount },
                                { label: 'Naked', value: spreadEfficiency.nakedCount },
                            ]}
                            colors={['bg-emerald-500', 'bg-sky-500', 'bg-red-500']}
                        />
                    </MetricCard>

                    {/* ─── DTE Management ─── */}
                    <MetricCard
                        title="DTE Management"
                        icon={<Clock className="h-3.5 w-3.5 text-warning" />}
                        score={dteManagement.score}
                        tooltip="Scores WHEN options expire. Theta decay is non-linear — accelerates exponentially below 21 DTE. Sweet spot is 7-21 DTE. Uses Gaussian scoring centered on 14 DTE with consistency bonus for systematic execution."
                    >
                        <div className="text-xs text-slate-400 space-y-1">
                            <StatRow
                                label="Avg DTE"
                                value={dteManagement.avgDTE !== null ? `${dteManagement.avgDTE} days` : '—'}
                            />
                            {dteManagement.gammaRiskFlag && (
                                <div className="flex items-center gap-1 text-red-400">
                                    <AlertTriangle className="h-3 w-3" />
                                    <span className="text-[10px]">Elevated gamma risk</span>
                                </div>
                            )}
                        </div>
                        <MiniBar
                            segments={[
                                { label: '0-7d', value: dteManagement.distribution.weekly },
                                { label: '8-14d', value: dteManagement.distribution.biweekly },
                                { label: '15-35d', value: dteManagement.distribution.monthly },
                                { label: '35d+', value: dteManagement.distribution.longDated },
                            ]}
                            colors={['bg-red-500', 'bg-amber-500', 'bg-emerald-500', 'bg-sky-500']}
                        />
                    </MetricCard>

                    {/* ─── Concentration Risk ─── */}
                    <MetricCard
                        title="Concentration Risk"
                        icon={<PieChart className="h-3.5 w-3.5 text-[#f472b6]" />}
                        score={concentrationRisk.score}
                        tooltip="Measures diversification using the Herfindahl-Hirschman Index (HHI) across underlyings by notional value. Also flags expiry clustering where too many positions expire on a single date (correlated risk event)."
                    >
                        <div className="text-xs text-slate-400 space-y-1">
                            <StatRow
                                label="HHI"
                                value={concentrationRisk.hhi !== null ? concentrationRisk.hhi.toFixed(4) : '—'}
                                valueClass={concentrationRisk.hhi !== null
                                    ? concentrationRisk.hhi < 0.15 ? 'text-emerald-400' : concentrationRisk.hhi < 0.3 ? 'text-amber-400' : 'text-red-400'
                                    : 'text-white'}
                            />
                            <StatRow label="Underlyings" value={`${concentrationRisk.uniqueUnderlyings}`} />
                            {concentrationRisk.topExpiryConcentration !== null && (
                                <StatRow
                                    label="Top Expiry"
                                    value={`${concentrationRisk.topExpiryConcentration.toFixed(0)}% of notional`}
                                    valueClass={concentrationRisk.topExpiryConcentration > 80 ? 'text-red-400' : 'text-white'}
                                />
                            )}
                            <StatRow label="Expiry Dates" value={`${concentrationRisk.expiryCount}`} />
                        </div>
                    </MetricCard>

                    {/* ─── Roll Behavior ─── */}
                    <MetricCard
                        title="Roll Behavior"
                        icon={<RefreshCw className="h-3.5 w-3.5 text-meta" />}
                        score={rollBehavior.score}
                        tooltip="Tracks how positions are managed at expiry. Detects rolls by comparing daily snapshots. Scores roll timing (ideal: 3-7 DTE) and tracks roll direction (up=bullish, down=defensive). Synthetic-stock legs are excluded."
                    >
                        <div className="text-xs text-slate-400 space-y-1">
                            <StatRow label="Rolls Detected" value={`${rollBehavior.rollsDetected}`} />
                            <StatRow
                                label="Avg Roll DTE"
                                value={rollBehavior.avgRollDTE !== null ? `${rollBehavior.avgRollDTE} days` : '—'}
                            />
                        </div>
                        {rollBehavior.rollsDetected > 0 && (
                            <MiniBar
                                segments={[
                                    { label: 'Up', value: rollBehavior.strikeAdjustments.rolledUp },
                                    { label: 'Same', value: rollBehavior.strikeAdjustments.same },
                                    { label: 'Down', value: rollBehavior.strikeAdjustments.rolledDown },
                                ]}
                                colors={['bg-emerald-500', 'bg-slate-500', 'bg-red-500']}
                            />
                        )}
                    </MetricCard>

                    {/* ─── Spread Details ─── */}
                    {spreadEfficiency.spreads.length > 0 && (
                        <MetricCard
                            title="Detected Spreads"
                            icon={<Activity className="h-3.5 w-3.5 text-warning" />}
                            score={null}
                            tooltip="Sample of detected defined-risk spread structures. Shows underlying, type, strikes, width (absolute and as % of underlying), and risk/reward ratio (premium ÷ max loss)."
                        >
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                {spreadEfficiency.spreads.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between text-[11px]">
                                        <span className="font-mono text-white">{s.underlying}</span>
                                        <span className="text-slate-400">
                                            {s.type} {s.shortStrike}/{s.longStrike}
                                        </span>
                                        <span className="text-slate-500">${s.width} ({s.widthPct}%)</span>
                                        <span className={s.riskReward > 0.2 ? 'text-emerald-400' : 'text-slate-500'}>
                                            R:R {(s.riskReward * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </MetricCard>
                    )}

                    {/* ─── Dynamic Weights ─── */}
                    <MetricCard
                        title="Composite Weights"
                        icon={<TrendingUp className="h-3.5 w-3.5 text-subtext" />}
                        score={null}
                        tooltip="The final grade uses dynamic weights that shift based on data confidence (more data = higher weight) and risk signals (low hedge score = hedge weight increases). These are the actual weights used for this fund."
                    >
                        <div className="space-y-1 text-[10px]">
                            {data.weights && Object.entries(data.weights)
                                .sort(([, a], [, b]) => b - a)
                                .map(([key, weight]) => (
                                    <div key={key} className="flex items-center gap-2">
                                        <div className="flex-1 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                                            <div
                                                className="h-full bg-meta rounded-full transition-all"
                                                style={{ width: `${weight * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-slate-500 w-24 truncate">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                        <span className="font-mono text-slate-400 w-10 text-right">{(weight * 100).toFixed(0)}%</span>
                                    </div>
                                ))}
                        </div>
                    </MetricCard>

                </div>

                {/* Peer Comparison */}
                <PeerComparison currentFund={fund} />

                {/* Methodology + disclaimer */}
                <MethodologySection />

                <p className="text-[10px] text-slate-600 mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Effectiveness metrics are based on {data.historyDepth}-day snapshot analysis using approximate Greeks (σ=30%).
                    Not investment advice. Scores improve with more historical data.
                </p>
            </CardContent>
        </Card>
    );
}

// ─── Peer Comparison ─────────────────────────────────────────────────────────

interface PeerFund {
    fund: string;
    grade: string;
    compositeScore: number | null;
    peerGroup: string;
    strikeSelection: { score: number | null };
    dteManagement: { score: number | null };
    spreadEfficiency: { score: number | null };
    hedgeRatio: { score: number | null };
    premiumCapture: { score: number | null };
}

const peerMetrics = [
    { key: 'composite', label: 'Overall' },
    { key: 'strike', label: 'Strike' },
    { key: 'dte', label: 'DTE' },
    { key: 'spread', label: 'Spread' },
    { key: 'hedge', label: 'Hedge' },
    { key: 'premium', label: 'Premium' },
];

function getPeerScore(f: PeerFund, key: string): number | null {
    switch (key) {
        case 'composite': return f.compositeScore;
        case 'strike': return f.strikeSelection?.score ?? null;
        case 'dte': return f.dteManagement?.score ?? null;
        case 'spread': return f.spreadEfficiency?.score ?? null;
        case 'hedge': return f.hedgeRatio?.score ?? null;
        case 'premium': return f.premiumCapture?.score ?? null;
        default: return null;
    }
}

function PeerComparison({ currentFund }: { currentFund: string }) {
    const [peers, setPeers] = useState<PeerFund[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch(`${API_BASE}/api/v1/fund-effectiveness`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.funds) setPeers(data.funds);
            })
            .catch(() => { })
            .finally(() => setLoaded(true));
    }, []);

    if (!loaded || peers.length < 2) return null;

    const sorted = [...peers].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
    const rank = sorted.findIndex(f => f.fund === currentFund) + 1;

    return (
        <div className="mt-3 border-t border-surface-elevated pt-3">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    <TrendingUp className="h-3 w-3 text-equity" />
                    Peer Comparison
                    <span className="font-normal text-slate-500 normal-case">
                        — Rank {rank} of {sorted.length}
                    </span>
                </div>
                <Link
                    href="/effectiveness"
                    className="text-[10px] text-equity hover:text-white transition-colors flex items-center gap-0.5"
                >
                    Full comparison <ArrowRight className="h-3 w-3" />
                </Link>
            </div>
            <div className="space-y-1.5">
                {peerMetrics.map(m => {
                    const currentScore = getPeerScore(
                        sorted.find(f => f.fund === currentFund) || sorted[0],
                        m.key
                    );
                    const maxScore = Math.max(...sorted.map(f => getPeerScore(f, m.key) ?? 0));

                    return (
                        <div key={m.key} className="flex items-center gap-2 text-[10px]">
                            <span className="text-slate-500 w-14 shrink-0">{m.label}</span>
                            <div className="flex-1 flex items-center gap-1 h-4">
                                {sorted.map(f => {
                                    const score = getPeerScore(f, m.key);
                                    const isCurrent = f.fund === currentFund;
                                    const width = maxScore > 0 ? ((score ?? 0) / 100) * 100 : 0;
                                    return (
                                        <div
                                            key={f.fund}
                                            className="relative group flex-1"
                                            title={`${f.fund}: ${score !== null ? Math.round(score) : '—'}`}
                                        >
                                            <div className="h-3 rounded-sm bg-surface-elevated overflow-hidden">
                                                <div
                                                    className={`h-full rounded-sm transition-all ${isCurrent
                                                        ? 'bg-equity'
                                                        : score !== null && score >= 80
                                                            ? 'bg-emerald-500/40'
                                                            : score !== null && score >= 60
                                                                ? 'bg-amber-500/40'
                                                                : 'bg-slate-600/40'
                                                        }`}
                                                    style={{ width: `${width}%` }}
                                                />
                                            </div>
                                            <span className={`absolute -top-0.5 left-0.5 text-[8px] font-mono leading-none ${isCurrent ? 'text-white font-bold' : 'text-slate-500'
                                                }`}>
                                                {f.fund}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
