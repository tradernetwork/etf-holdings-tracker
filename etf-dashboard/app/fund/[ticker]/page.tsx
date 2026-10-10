// Fund profile page — two templates, picked by the fund's category:
//
//   active-equity  → conviction over time. A Daily/Weekly/Monthly toggle, a
//                    New Entrances / Total Exits marquee, and a streak tracker.
//                    Daily holdings noise is exactly what obscures these funds.
//   option-income  → a brokerage-style Positions table (stock rows with their
//                    option legs, covered/uncovered split, sortable/filterable,
//                    state in the URL), then option activity, rolls and
//                    strategy effectiveness.
//
// AUM comes straight from the API's `aum` field on ApiFundDetail (backend's
// get_fund_aum(), derived from the latest holdings snapshot). The static
// FUND_AUM table is only a last-resort fallback for a fund the API doesn't
// know about.
import { api } from '@/lib/api';
import type {
    ApiChangeRecord, ApiFundDetail, ApiFundStreak, ApiOptionRoll, ApiOptionSignal,
} from '@/lib/api';
import { FUND_AUM } from '@/lib/providers';
import { formatAum } from '@/lib/utils';
import { SiteNav } from '@/components/site-nav';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/data-table';
import {
    ArrowUpRight, ArrowDownRight, ArrowLeft, ArrowRight, Layers, Zap, Plus, X,
    ChevronUp, ChevronDown, Flame, CalendarDays, TrendingUp, TrendingDown, Repeat,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import React, { Suspense } from 'react';
import { FundEffectiveness } from '@/components/fund-effectiveness';
import { RotationPanel } from '@/components/rotation-panel';
import { FundPositions } from '@/components/fund-positions';
import { catchUpLabel } from '@/lib/catch-up';
import { OptionActivity } from '@/components/option-activity';

// The page reads searchParams (the Daily/Weekly/Monthly toggle), so it MUST
// be dynamically rendered. A statically-generated route cannot touch
// searchParams — doing so throws DYNAMIC_SERVER_USAGE in a production build
// (dev mode is lenient, which is why this slipped through once).
//
// force-dynamic also subsumes the original "never pre-render" fix: the route
// is never statically generated, so a transient API blip during `next build`
// can't bake a permanent 404 (the bug that first broke /fund/AVUV). The
// api.fund() / api.changes() calls still cache at the fetch level, so the
// API is not hit on every single request.
export const dynamic = 'force-dynamic';

type Period = 'daily' | 'weekly' | 'monthly';

// Active-equity funds default to the weekly window — daily holdings noise is
// exactly what obscures their real conviction.
function normalizePeriod(p?: string): Period {
    return p === 'daily' || p === 'monthly' ? p : 'weekly';
}

const PERIOD_LABEL: Record<Period, string> = {
    daily: 'since yesterday',
    weekly: 'past 7 days',
    monthly: 'past 30 days',
};

function formatAsOfDate(asOf: string): string {
    return new Date(`${asOf}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
}

// Signed percent for the fund-flow stat — +1.7% / -2.3% / 0.0%.
function fmtFlowPct(pct: number): string {
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ─── Inline option-signal decoder (was decodeOptionSignal in holdings.ts) ────

function decodeOptionSignal(r: ApiChangeRecord): ApiOptionSignal | null {
    if (!r.isOption || !r.optionDetails) return null;
    const type = r.optionDetails.type.toLowerCase();
    const strike = r.optionDetails.strike;
    const moneyness = r.currentWeight > 0 ? 'OTM (likely)' : 'ATM/ITM';
    if (type.startsWith('p')) {
        return { strategy: 'Cash-Secured Put', directionalView: `Bullish above $${strike}`, moneyness };
    }
    if (type.startsWith('c')) {
        return { strategy: 'Covered Call', directionalView: `Capping upside at $${strike}`, moneyness };
    }
    return null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function FundProfilePage({
    params,
    searchParams,
}: {
    params: Promise<{ ticker: string }>;
    searchParams: Promise<{ period?: string }>;
}) {
    const { ticker } = await params;
    const sp = await searchParams;
    const fund = ticker.toUpperCase();
    const detail = await api.fund(fund);

    if (!detail) notFound();

    const aum = detail.aum ?? FUND_AUM[fund];
    // Defensive fallback: if the API predates the `category` field, infer it
    // from whether the fund carries an option book.
    const category = detail.category ?? (detail.optionsCount > 0 ? 'option-income' : 'active-equity');

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 space-y-6 font-sans">
            <SiteNav />
            <FundHeader detail={detail} aum={aum} category={category} />
            {category === 'option-income' ? (
                <OptionIncomeBody detail={detail} fund={fund} />
            ) : (
                <ActiveEquityBody detail={detail} fund={fund} period={normalizePeriod(sp.period)} />
            )}
        </div>
    );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function FundHeader({ detail, aum, category }: {
    detail: ApiFundDetail;
    aum: number | undefined;
    category: 'active-equity' | 'option-income';
}) {
    const isIncome = category === 'option-income';
    return (
        <div className="bg-surface border border-rule p-4 rounded-xl shadow-lg">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <Link href="/funds" className="text-xs text-slate-500 hover:text-white transition-colors flex items-center gap-1 mb-2">
                        <ArrowLeft className="h-3 w-3" /> Back to Funds
                    </Link>
                    <h1 className="text-3xl font-black tracking-tight flex items-center gap-3 flex-wrap">
                        <span className="text-equity font-mono">{detail.fund}</span>
                        <Badge variant="outline" className="text-slate-400 border-slate-600 font-normal text-sm">
                            {detail.provider}
                        </Badge>
                        <Badge
                            variant="outline"
                            className="font-normal text-xs"
                            style={{
                                color: isIncome ? 'var(--meta)' : 'var(--buy)',
                                borderColor: isIncome ? 'color-mix(in srgb, var(--meta) 33%, transparent)' : 'color-mix(in srgb, var(--buy) 33%, transparent)',
                            }}
                        >
                            {isIncome ? 'Option-Income' : 'Active-Equity'}
                        </Badge>
                    </h1>
                    {detail.asOfDate && (
                        <p className="text-xs text-slate-500 font-mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>as of {formatAsOfDate(detail.asOfDate)}</span>
                            {detail.holdingsDate && detail.holdingsDate !== detail.asOfDate && (
                                <span>· issuer file {formatAsOfDate(detail.holdingsDate)}</span>
                            )}
                            {detail.catchUp && (
                                <span
                                    className="font-sans text-[10px] px-1.5 py-0.5 rounded border border-warning/40 bg-warning/10 text-warning"
                                    title="This fund's issuer data was stale and has just returned. Its daily changes are withheld because they would span the whole gap, not one day."
                                >
                                    {catchUpLabel(detail.catchUpSince)}
                                </span>
                            )}
                            {(detail.stale || detail.refreshed === false) && (
                                <span
                                    className="font-sans text-[10px] px-1.5 py-0.5 rounded border border-warning/40 bg-warning/10 text-warning"
                                    title="The issuer hasn't published newer holdings, or today's download failed and yesterday's rows are shown"
                                >
                                    {detail.refreshed === false ? 'not refreshed today' : 'stale'}
                                </span>
                            )}
                        </p>
                    )}
                </div>
                <div className="flex gap-3 flex-wrap">
                    <StatBox label="Holdings" value={detail.holdingsCount.toString()} />
                    {isIncome && <StatBox label="Options" value={detail.optionsCount.toString()} />}
                    {aum && <StatBox label="AUM" value={formatAum(aum)} />}
                    <StatBox label="Total Wt" value={`${detail.totalWeight.toFixed(1)}%`} />
                    {detail.flow && (
                        <StatBox
                            label={`Net Flow ${detail.flow.periodDays}d`}
                            value={fmtFlowPct(detail.flow.flowPct)}
                            valueClass={detail.flow.flowPct >= 0 ? 'text-buy' : 'text-sell'}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Active-equity body ──────────────────────────────────────────────────────

async function ActiveEquityBody({ detail, fund, period }: {
    detail: ApiFundDetail;
    fund: string;
    period: Period;
}) {
    // limit 1000 — the marquee needs the TRUE entrance/exit count, so fetch
    // the whole window. Even AVUV (~800 holdings) tops out around 800 changes
    // monthly, so 1000 captures every move without clipping.
    const res = await api.changes({ fund, period, limit: 1000 }, { throwOnError: false });
    const changes = res?.changes ?? [];

    const entrances = changes.filter(c => c.type === 'NEW');
    const exits = changes.filter(c => c.type === 'REMOVED');
    const increased = changes
        .filter(c => c.type === 'CHANGED' && (c.activeWeightDelta ?? c.weightDelta) > 0)
        .sort((a, b) => (b.activeWeightDelta ?? b.weightDelta) - (a.activeWeightDelta ?? a.weightDelta));
    const trimmed = changes
        .filter(c => c.type === 'CHANGED' && (c.activeWeightDelta ?? c.weightDelta) < 0)
        .sort((a, b) => (a.activeWeightDelta ?? a.weightDelta) - (b.activeWeightDelta ?? b.weightDelta));

    const streaks = detail.streaks ?? [];
    const topHoldings = detail.topHoldings ?? [];

    return (
        <>
            <PeriodToggle period={period} fund={fund} />

            {/* Marquee — the structural decisions in this window */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MarqueeCard kind="entrances" records={entrances} period={period} />
                <MarqueeCard kind="exits" records={exits} period={period} />
            </div>

            {/* Position sizing — the marginal resize moves */}
            <Card className="bg-surface border-rule">
                <CardHeader className="pb-3 border-b border-rule">
                    <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                        <Zap className="h-5 w-5 text-warning" /> Position Sizing
                        <span className="text-xs font-normal text-slate-500 ml-auto">
                            existing holdings resized · {PERIOD_LABEL[period]}
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                    {increased.length === 0 && trimmed.length === 0 ? (
                        <EmptyState label="No position resizing in this window" />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {increased.length > 0 && (
                                <ChangeSection
                                    title="Increased"
                                    icon={<ChevronUp className="h-3.5 w-3.5" />}
                                    records={increased.slice(0, 12)}
                                    color="green"
                                />
                            )}
                            {trimmed.length > 0 && (
                                <ChangeSection
                                    title="Trimmed"
                                    icon={<ChevronDown className="h-3.5 w-3.5" />}
                                    records={trimmed.slice(0, 12)}
                                    color="red"
                                />
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {streaks.length > 0 && <StreakTracker streaks={streaks} />}

            <TopHoldingsTable holdings={topHoldings} />
        </>
    );
}

// ─── Option-income body ──────────────────────────────────────────────────────

async function OptionIncomeBody({ detail, fund }: { detail: ApiFundDetail; fund: string }) {
    // An API blip on the income endpoint must not take the whole fund page
    // down — it falls back to the plain holdings list below instead.
    const income = await api.incomeFund(fund).catch(() => null);
    const hasPositions = !!income?.positions && !!income.positionsSummary;

    const recentChanges = detail.recentChanges ?? [];
    const equityChanges = recentChanges.filter(c => !c.isOption);
    const optionChanges = recentChanges.filter(c => c.isOption);

    // The Positions table carries today's stock changes itself (a Δ today
    // column, a "Changed today" filter, NEW badges and an "Exited today"
    // line), so these per-type lists only render as the fallback.
    const newPositions = equityChanges.filter(c => c.type === 'NEW');
    const closedPositions = equityChanges.filter(c => c.type === 'REMOVED');
    const increased = equityChanges.filter(c => c.type === 'CHANGED' && (c.activeWeightDelta ?? c.weightDelta) > 0);
    const trimmed = equityChanges.filter(c => c.type === 'CHANGED' && (c.activeWeightDelta ?? c.weightDelta) < 0);
    const shownEquityChanges = hasPositions ? [] : equityChanges;
    const hasChanges = shownEquityChanges.length > 0 || optionChanges.length > 0;

    return (
        <>
            {/* Positions — brokerage-style: one row per stock, legs underneath,
                covered / uncovered split, sortable and filterable. Replaces the
                old Strategy Map, expiry-grouped Portfolio card, Top Holdings
                table and the stock half of Daily Activity. */}
            {hasPositions && income && (
                <Suspense fallback={null}>
                    <FundPositions income={income} changes={equityChanges} />
                </Suspense>
            )}

            {/* Dated option trades (contract-based, paired into rolls/spreads/
                synthetics). Replaces the Rolls card and the weight-driven
                ADDED/TRIMMED grid whenever the API provides it. */}
            {income?.optionActivity && income.optionActivity.length > 0 && (
                <OptionActivity days={income.optionActivity} />
            )}

            {/* Fallback for API deploys without optionActivity: the old Rolls
                card and daily activity (plus stock churn when the Positions
                table isn't available to show it). */}
            {!income?.optionActivity && (detail.optionRolls ?? []).length > 0 && <RollHistory rolls={detail.optionRolls} />}
            {(!income?.optionActivity || !hasPositions) && (
            <Card className="bg-surface border-rule">
                <CardHeader className="pb-3 border-b border-rule">
                    <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                        <Zap className="h-5 w-5 text-warning" /> {hasPositions ? 'Option Activity' : 'Daily Activity'}
                        {hasChanges && (
                            <span className="text-xs font-normal text-slate-500 ml-auto">
                                {hasPositions
                                    ? `${optionChanges.length} contract${optionChanges.length === 1 ? '' : 's'}`
                                    : `${equityChanges.length} equity • ${optionChanges.length} options`}
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                    {!hasChanges ? (
                        <EmptyState label={detail.catchUp
                            ? `${catchUpLabel(detail.catchUpSince)}: daily changes are withheld, not shown as one day's trades`
                            : hasPositions ? 'No contracts opened or closed today' : 'No changes detected today'} />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {!hasPositions && newPositions.length > 0 && (
                                <ChangeSection title="New Positions" icon={<Plus className="h-3.5 w-3.5" />} records={newPositions} color="cyan" />
                            )}
                            {!hasPositions && closedPositions.length > 0 && (
                                <ChangeSection title="Closed" icon={<X className="h-3.5 w-3.5" />} records={closedPositions} color="amber" />
                            )}
                            {!hasPositions && increased.length > 0 && (
                                <ChangeSection title="Increased" icon={<ChevronUp className="h-3.5 w-3.5" />} records={increased} color="green" />
                            )}
                            {!hasPositions && trimmed.length > 0 && (
                                <ChangeSection title="Trimmed" icon={<ChevronDown className="h-3.5 w-3.5" />} records={trimmed} color="red" />
                            )}
                            {optionChanges.length > 0 && (
                                <div className="md:col-span-2">
                                    <OptionsChangeSection records={optionChanges} />
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
            )}

            <FundEffectiveness fund={detail.fund} />

            <RotationPanel fund={detail.fund} />

            {!hasPositions && <TopHoldingsTable holdings={detail.topHoldings ?? []} />}
        </>
    );
}

// ─── Roll history ────────────────────────────────────────────────────────────

function RollHistory({ rolls }: { rolls: ApiOptionRoll[] }) {
    const fmtLeg = (leg: { strike: number; expiry: string }, call: boolean) =>
        `${call ? 'C' : 'P'}$${leg.strike}${leg.expiry ? ` · ${leg.expiry}` : ''}`;
    return (
        <Card className="bg-surface border-rule">
            <CardHeader className="pb-3 border-b border-rule">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                    <Repeat className="h-5 w-5 text-meta" /> Option Rolls
                    <span className="text-xs font-normal text-slate-500 ml-auto">
                        positions rolled, not closed
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
                <div className="space-y-2">
                    {rolls.map((roll, i) => {
                        const call = (roll.optionType || '').toLowerCase().startsWith('c');
                        return (
                            <div
                                key={`${roll.underlying}-${i}`}
                                className="bg-surface-alt border border-surface-elevated rounded-lg px-3 py-2.5"
                            >
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="font-mono font-bold text-sm text-white">{roll.underlying}</span>
                                    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                                        {call ? 'Covered Call' : 'Cash-Secured Put'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
                                    {roll.closed.map((leg, j) => (
                                        <span key={`c-${j}`} className="text-slate-500 line-through">
                                            {fmtLeg(leg, call)}
                                        </span>
                                    ))}
                                    <ArrowRight className="h-3.5 w-3.5 text-meta shrink-0" />
                                    {roll.opened.map((leg, j) => (
                                        <span key={`o-${j}`} className="text-equity">
                                            {fmtLeg(leg, call)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <p className="text-[10px] text-slate-600 mt-3">
                    A roll closes one contract and opens another on the same underlying —
                    routine income-fund mechanics (extending duration or repricing the
                    strike), not a directional exit.
                </p>
            </CardContent>
        </Card>
    );
}

// ─── Period toggle ───────────────────────────────────────────────────────────

function PeriodToggle({ period, fund }: { period: Period; fund: string }) {
    const opts: { key: Period; label: string; href: string }[] = [
        { key: 'daily', label: 'Daily', href: `/fund/${fund}?period=daily` },
        { key: 'weekly', label: 'Weekly', href: `/fund/${fund}` },
        { key: 'monthly', label: 'Monthly', href: `/fund/${fund}?period=monthly` },
    ];
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-500 mr-1">Position changes over:</span>
            <div className="inline-flex rounded-lg border border-rule bg-surface-alt p-0.5">
                {opts.map(o => {
                    const active = o.key === period;
                    return (
                        <Link
                            key={o.key}
                            href={o.href}
                            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${active ? 'bg-equity text-canvas' : 'text-slate-400 hover:text-white'}`}
                        >
                            {o.label}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Marquee card (New Entrances / Total Exits) ──────────────────────────────

function MarqueeCard({ kind, records, period }: {
    kind: 'entrances' | 'exits';
    records: ApiChangeRecord[];
    period: Period;
}) {
    const isEntrances = kind === 'entrances';
    const accent = isEntrances ? 'var(--buy)' : 'var(--sell)';
    const Icon = isEntrances ? TrendingUp : TrendingDown;
    const title = isEntrances ? 'New Entrances' : 'Total Exits';
    const verb = isEntrances ? 'entered' : 'exited';

    return (
        <div
            className="rounded-xl border p-4"
            style={{ borderColor: `color-mix(in srgb, ${accent} 20%, transparent)`, backgroundColor: `color-mix(in srgb, ${accent} 4%, transparent)` }}
        >
            <div className="flex items-center gap-2 mb-3">
                <Icon className="h-4 w-4" style={{ color: accent }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>{title}</span>
                <span className="text-[10px] text-slate-500 ml-auto">{PERIOD_LABEL[period]}</span>
            </div>
            <div className="flex items-baseline gap-2 mb-3">
                <span className="text-4xl font-black font-mono" style={{ color: accent }}>{records.length}</span>
                <span className="text-xs text-slate-500">
                    position{records.length !== 1 ? 's' : ''} {verb}
                </span>
            </div>
            {records.length === 0 ? (
                <p className="text-xs text-slate-600">None this window — no structural change.</p>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {records.slice(0, 16).map((r, i) => (
                        <Link
                            key={`${r.ticker}-${i}`}
                            href={`/stocks/${r.ticker}`}
                            title={`${r.name}${r.sector ? ' · ' + r.sector : ''}`}
                            className="font-mono text-xs font-bold px-2 py-0.5 rounded border transition-opacity hover:opacity-80"
                            style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 27%, transparent)`, backgroundColor: `color-mix(in srgb, ${accent} 8%, transparent)` }}
                        >
                            <span className={isEntrances ? '' : 'line-through'}>{r.ticker}</span>
                        </Link>
                    ))}
                    {records.length > 16 && (
                        <span className="text-xs text-slate-500 self-center">+{records.length - 16} more</span>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Streak tracker ──────────────────────────────────────────────────────────

function StreakTracker({ streaks }: { streaks: ApiFundStreak[] }) {
    // streaks arrive sorted longest-first; a broad fund can carry 100+, so
    // show the most-established and summarise the rest.
    const shown = streaks.slice(0, 24);
    const extra = streaks.length - shown.length;
    return (
        <Card className="bg-surface border-rule">
            <CardHeader className="pb-3 border-b border-rule">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                    <Flame className="h-5 w-5 text-warning" /> Conviction Streaks
                    <span className="text-xs font-normal text-slate-500 ml-auto">
                        {streaks.length} active · consecutive-day moves
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
                <div className="flex flex-wrap gap-2 items-center">
                    {shown.map((s, i) => {
                        const up = s.direction === 'up';
                        const accent = up ? 'var(--buy)' : 'var(--sell)';
                        return (
                            <Link
                                key={`${s.ticker}-${i}`}
                                href={`/stocks/${s.ticker}`}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-surface-alt hover:bg-surface-hover transition-colors"
                                style={{ borderColor: `color-mix(in srgb, ${accent} 20%, transparent)` }}
                            >
                                <span className="font-mono font-bold text-sm text-white">{s.ticker}</span>
                                {up
                                    ? <ArrowUpRight className="h-3.5 w-3.5" style={{ color: accent }} />
                                    : <ArrowDownRight className="h-3.5 w-3.5" style={{ color: accent }} />}
                                <span className="font-mono text-xs font-semibold" style={{ color: accent }}>{s.days}d</span>
                            </Link>
                        );
                    })}
                    {extra > 0 && (
                        <span className="text-xs text-slate-500">+{extra} more</span>
                    )}
                </div>
                <p className="text-[10px] text-slate-600 mt-3">
                    A streak counts consecutive snapshots the fund moved a position the same
                    direction — accumulating (green) or distributing (red). The clearest read
                    on where conviction is building.
                </p>
            </CardContent>
        </Card>
    );
}

// ─── Top Holdings table ──────────────────────────────────────────────────────

function TopHoldingsTable({ holdings }: { holdings: ApiFundDetail['topHoldings'] }) {
    if (holdings.length === 0) return null;
    return (
        <Card className="bg-surface border-rule">
            <CardHeader className="pb-3 border-b border-rule">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                    <Layers className="h-5 w-5 text-equity" /> Top Holdings
                    <span className="text-xs font-normal text-slate-500 ml-auto">top {holdings.length} by weight</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
                {(() => {
                    // No mobile priority previously existed on this table (table-fork
                    // audit finding). Chosen here: rank + ticker + weight + active-weight
                    // Δ are load-bearing at 375px; name, raw shares and raw Δ shares
                    // (transparency data per table-fork.md) return at md/lg/xl.
                    const columns: DataTableColumn[] = [
                        { key: 'rank', header: '#', headerClassName: 'w-8' },
                        { key: 'ticker', header: 'Ticker' },
                        { key: 'name', header: 'Name', mobilePriority: 'md' },
                        { key: 'weight', header: 'Weight', align: 'right' },
                        { key: 'weightDelta', header: 'Δ Wt', align: 'right' },
                        { key: 'shares', header: 'Shares', align: 'right', mobilePriority: 'lg' },
                        { key: 'sharesDelta', header: 'Δ Shares', align: 'right', mobilePriority: 'xl' },
                    ];
                    const rows: DataTableRow[] = holdings.map((h, i) => {
                        const barWidth = holdings[0]?.weight > 0 ? (h.weight / holdings[0].weight) * 100 : 0;
                        // null on a catch-up fund (delta would span a stale gap): show '—', not a number.
                        const delta = h.activeWeightDelta ?? h.weightDelta ?? 0;
                        const hasChange = Math.abs(delta) > 0.0005;
                        const sharesDelta = h.sharesDelta ?? 0;
                        const hasSharesChange = sharesDelta !== 0;
                        return {
                            key: h.ticker,
                            cells: {
                                rank: <span className="text-xs text-slate-500 font-mono">{i + 1}</span>,
                                ticker: (
                                    <Link href={`/stocks/${h.ticker}`} className="font-mono font-medium text-equity hover:underline">
                                        {h.ticker}
                                    </Link>
                                ),
                                name: <span className="text-slate-400 max-w-[160px] truncate text-xs block" title={h.name}>{h.name}</span>,
                                weight: (
                                    <div className="flex items-center justify-end gap-2">
                                        <div className="w-12 bg-rule rounded-full h-1.5 overflow-hidden">
                                            <div className="h-full bg-equity rounded-full" style={{ width: `${barWidth}%`, opacity: 0.6 }} />
                                        </div>
                                        <span className="font-mono text-white min-w-[48px] text-right text-xs">{h.weight.toFixed(3)}%</span>
                                    </div>
                                ),
                                weightDelta: (
                                    <span className={`font-mono text-xs ${!hasChange ? 'text-slate-600' : delta > 0 ? 'text-buy' : 'text-sell'}`}>
                                        {hasChange ? (
                                            <span className="flex items-center justify-end gap-0.5">
                                                {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                                {delta > 0 ? '+' : ''}{delta.toFixed(3)}%
                                            </span>
                                        ) : '—'}
                                    </span>
                                ),
                                shares: <span className="font-mono text-slate-300 text-xs">{h.shares.toLocaleString()}</span>,
                                sharesDelta: (
                                    <span className={`font-mono text-xs ${!hasSharesChange ? 'text-slate-600' : sharesDelta > 0 ? 'text-buy' : 'text-sell'}`}>
                                        {hasSharesChange ? (
                                            <span className="flex items-center justify-end gap-0.5">
                                                {sharesDelta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                                {sharesDelta > 0 ? '+' : ''}{sharesDelta.toLocaleString()}
                                            </span>
                                        ) : '—'}
                                    </span>
                                ),
                            },
                        };
                    });
                    return (
                        <DataTable
                            columns={columns}
                            rows={rows}
                            emptyMessage="No holdings."
                        />
                    );
                })()}
            </CardContent>
        </Card>
    );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
    return (
        <div className="text-center py-8 text-slate-500">
            <Zap className="h-8 w-8 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs mt-1 text-slate-600">Data updates on weekday mornings when the scraper runs.</p>
        </div>
    );
}

// ─── Change section ──────────────────────────────────────────────────────────

const colorMap = {
    cyan: { bg: 'bg-equity/5', border: 'border-equity/20', text: 'text-equity', badge: 'text-equity border-equity/30', dot: 'bg-equity' },
    green: { bg: 'bg-buy/5', border: 'border-buy/20', text: 'text-buy', badge: 'text-buy border-buy/30', dot: 'bg-buy' },
    red: { bg: 'bg-sell/5', border: 'border-sell/20', text: 'text-sell', badge: 'text-sell border-sell/30', dot: 'bg-sell' },
    amber: { bg: 'bg-warning/5', border: 'border-warning/20', text: 'text-warning', badge: 'text-warning border-warning/30', dot: 'bg-warning' },
} as const;

// A high-contrast pill that makes the major portfolio decisions — a position
// entered or exited — pop out from the marginal +/- noise around them.
//
// Tone is deliberate: an equity EXIT is red (a real conviction exit), but an
// option position CLOSED is neutral grey — closing an option is usually just
// an expiry or a roll, not a bearish call.

type PillTone = 'pos' | 'neg' | 'open' | 'neutral';

function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
    const style: Record<PillTone, string> = {
        pos: 'bg-buy/15 text-buy border-buy/40',
        neg: 'bg-sell/15 text-sell border-sell/40',
        open: 'bg-equity/15 text-equity border-equity/40',
        neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
    };
    return (
        <span className={`text-[9px] font-bold tracking-wide px-1.5 py-px rounded border shrink-0 ${style[tone]}`}>
            {label}
        </span>
    );
}

function ChangeSection({ title, icon, records, color }: {
    title: string;
    icon: React.ReactNode;
    records: ApiChangeRecord[];
    color: keyof typeof colorMap;
}) {
    const c = colorMap[color];
    return (
        <div className={`rounded-lg ${c.bg} ${c.border} border p-3`}>
            <div className={`flex items-center gap-1.5 mb-2.5 ${c.text} font-semibold text-xs uppercase tracking-wider`}>
                {icon} {title}
                <span className="text-slate-500 font-normal ml-auto">({records.length})</span>
            </div>
            <div className="space-y-1.5">
                {records.map((r, i) => {
                    const isNew = r.type === 'NEW';
                    const isExit = r.type === 'REMOVED';
                    return (
                        <div key={`${r.ticker}-${i}`} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                                <Link
                                    href={`/stocks/${r.ticker}`}
                                    className={`font-mono font-bold text-sm hover:text-equity transition-colors ${isExit ? 'text-slate-500 line-through' : 'text-white'}`}
                                >
                                    {r.ticker}
                                </Link>
                                {isNew && <StatusPill label="NEW" tone="pos" />}
                                {isExit && <StatusPill label="EXIT" tone="neg" />}
                                <span className="text-[11px] text-slate-500 truncate">{r.name}</span>
                                {r.sector && !r.isOption && (
                                    <span className="shrink-0 text-[9px] font-medium px-1.5 py-0 rounded border border-rule-strong bg-surface-elevated text-slate-500 leading-4 hidden sm:inline-block">
                                        {r.sector}
                                    </span>
                                )}
                            </div>
                            <span className={`font-mono text-sm shrink-0 font-semibold flex items-center gap-0.5 ${(r.activeWeightDelta ?? r.weightDelta) > 0 ? 'text-buy' : (r.activeWeightDelta ?? r.weightDelta) < 0 ? 'text-sell' : 'text-slate-400'
                                }`}>
                                {(r.activeWeightDelta ?? r.weightDelta) > 0 ? <ArrowUpRight className="h-3 w-3" /> : (r.activeWeightDelta ?? r.weightDelta) < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                                {(r.activeWeightDelta ?? r.weightDelta) > 0 ? '+' : ''}{(r.activeWeightDelta ?? r.weightDelta).toFixed(2)}%
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Options change section ──────────────────────────────────────────────────

function OptionsChangeSection({ records }: { records: ApiChangeRecord[] }) {
    return (
        <div className="rounded-lg bg-meta/5 border border-meta/20 p-3">
            <div className="flex items-center gap-1.5 mb-2.5 text-meta font-semibold text-xs uppercase tracking-wider">
                <Zap className="h-3.5 w-3.5" /> Options Activity
                <span className="text-slate-500 font-normal ml-auto">({records.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {records.slice(0, 12).map((r, i) => {
                    const decoded = decodeOptionSignal(r);
                    const isClosed = r.type === 'REMOVED';
                    // Options are framed as position mechanics, not buy/sell: a
                    // CLOSED contract is usually an expiry or a roll, so it stays
                    // neutral grey rather than reading as a bearish red EXIT.
                    const pill = r.type === 'NEW'
                        ? { label: 'OPENED', tone: 'open' as const }
                        : isClosed
                            ? { label: 'CLOSED', tone: 'neutral' as const }
                            : r.weightDelta > 0
                                ? { label: 'ADDED', tone: 'pos' as const }
                                : { label: 'TRIMMED', tone: 'neg' as const };
                    return (
                        <div key={`opt-${r.ticker}-${i}`} className="bg-surface-alt/60 rounded-md px-2.5 py-2 border border-surface-elevated">
                            <div className="flex items-center justify-between gap-1">
                                <span className={`font-mono font-bold text-xs truncate ${isClosed ? 'text-slate-500 line-through' : 'text-white'}`}>
                                    {r.optionDetails ? `${r.ticker.split(' ')[0]} ${r.optionDetails.type === 'Call' ? 'C' : 'P'}${r.optionDetails.strike}` : r.ticker}
                                </span>
                                <StatusPill label={pill.label} tone={pill.tone} />
                            </div>
                            {decoded && (
                                <p className="text-[10px] text-meta mt-0.5 truncate">{decoded.directionalView}</p>
                            )}
                            {r.optionDetails?.expiry && (
                                <p className="text-[9px] text-slate-600 mt-0.5">exp {r.optionDetails.expiry}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Stat box ────────────────────────────────────────────────────────────────

function StatBox({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
    return (
        <div className="bg-surface-alt border border-surface-elevated rounded-lg px-4 py-2">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</div>
            <div className={`text-lg font-bold font-mono ${valueClass || 'text-white'}`}>{value}</div>
        </div>
    );
}
