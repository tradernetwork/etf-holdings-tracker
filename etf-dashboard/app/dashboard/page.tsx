// Review #10 finale: dashboard now renders from the FastAPI server via lib/api.ts.
// The old holdings.ts code path was removed; only PROVIDER_ORDER (a static
// display-order list) is still imported from there.
import { api } from '@/lib/api';
import type {
  ApiSignal,
  ApiSignals,
  ApiBriefing,
  ApiActivity,
  ApiSectorFlow,
  ApiDivergence,
  ApiTickerDetail,
  ApiChangeRecord,
} from '@/lib/api';
// PROVIDER_ORDER (display order) is static reference data — fine to import
// from the otherwise-deprecated holdings.ts. The dashboard's dynamic data
// now all comes from lib/api.ts. getProvider/getETFColor/groupByProvider
// moved to lib/providers.ts and components/options-table.tsx so /income can
// share them without pulling in holdings.ts's `fs` dependency.
import { PROVIDER_ORDER } from '@/lib/holdings';
import { getETFColor, FUND_AUM } from '@/lib/providers';
import { OptionsTable, groupByProvider } from '@/components/options-table';
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ArrowUpRight, ArrowDownRight, Layers, PieChart, Activity,
  ChevronDown, TrendingUp, TrendingDown, Zap, Building2, Eye,
  Flame, Target, Crosshair, BarChart3, Search, GitFork, Bell
} from 'lucide-react';
import React from 'react';
import Link from 'next/link';
import fs from 'fs';
import path from 'path';
import { TickerSearchForm } from '@/components/ticker-search';
import { SiteNav } from '@/components/site-nav';
import { InstitutionalSummary } from '@/components/institutional-summary';
import { InstitutionalTrend } from '@/components/institutional-trend';
import { FundsGrid } from '@/components/funds-grid';
import { DiscordWebhook } from '@/components/discord-webhook';
import { KeyboardSearch } from '@/components/keyboard-search';
import { ActivityHeatmap } from '@/components/activity-heatmap';
import { AskTickerTrace } from '@/components/ask-tickertrace';
import { ShareButtons } from '@/components/share-buttons';
// Auth UI was removed when TickerTrace went fully open. ProGate was a no-op
// pass-through and got inlined out — if/when we ever paywall something again,
// reach for a fresh wrapper component rather than reviving the old surface.

export const revalidate = 3600;

/** Read the pre-computed signal-vs-price backtest from disk. The scrape
 *  workflow regenerates this file daily; the dashboard picks it up on
 *  the next ISR revalidation. Returns null if missing — card just won't
 *  render until the first scrape produces it. */
// Coerce a global stats record (FastAPI shape) into the dashboard's display shape.
function totalsFor(stats: { fundsTracked: number; uniqueTickers: number; putCallRatio: number; newPositionsToday?: number; exitsToday?: number }) {
  return {
    totalFunds: stats.fundsTracked,
    totalStocks: stats.uniqueTickers,
    pcRatio: stats.putCallRatio.toString(),
    newPositionsToday: stats.newPositionsToday,
    exitsToday: stats.exitsToday,
  };
}

// Flatten the API's {inflows, outflows} into a single sorted list for the card.
function flattenSectorFlow(flow: ApiSectorFlow) {
  return [...flow.inflows.map(e => ({ sector: e.sector, weightDelta: e.delta })),
          ...flow.outflows.map(e => ({ sector: e.sector, weightDelta: e.delta }))];
}

interface FlatSectorEntry { sector: string; weightDelta: number }

// Translate a signal's per-fund weight deltas into a total estimated dollar value.
// Mirrors the same estimateDollars logic in changes-client.tsx.
function estimateSignalDollars(signal: ApiSignal): string | null {
  let totalM = 0;
  for (const f of signal.fundDetails) {
    const aumB = f.aum ?? FUND_AUM[f.fund];
    if (!aumB) continue;
    totalM += Math.abs(f.weightDelta) / 100 * aumB * 1000;
  }
  if (totalM < 0.1) return null;
  if (totalM >= 1000) return `≈ $${(totalM / 1000).toFixed(1)}B`;
  if (totalM >= 1) return `≈ $${totalM.toFixed(1)}M`;
  return `≈ $${Math.round(totalM * 1000)}k`;
}

// Format a YYYY-MM-DD asOfDate string as "Jun 12, 2026" (UTC, no drift).
function formatAsOfDate(asOf: string): string {
  return new Date(`${asOf}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// Count business days between asOfDate and today (UTC). Mirrors check_freshness.py.
function businessDaysBehind(asOf: string): number {
  const start = new Date(`${asOf}T00:00:00Z`);
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let days = 0;
  const d = new Date(start);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0=Sun…6=Sat
    if (dow >= 1 && dow <= 5) days++;
  }
  return days;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const searchQuery = params.q?.toUpperCase().trim() || '';

  // Headline payload, weekly activity, optional ticker lookup, and the
  // leaderboard-home data (cross-fund institutional aggregate + tracked-funds
  // list) are all independent of each other — fetch them concurrently rather
  // than one-at-a-time. Sequential awaits here used to sum every endpoint's
  // latency; a single slow endpoint (institutionalTrend has been observed
  // taking minutes under load) could then blow Vercel's 300s function budget
  // on its own, which killed the whole render — including the background ISR
  // revalidation — and left the page stuck serving stale cached data
  // indefinitely since a failed regeneration never replaces the old cache.
  // throwOnError: false lets the !payload / !weeklyBuySell guards below
  // render the empty-state shell instead of crashing the build when the API
  // is unreachable (eg. backend down). Was the cause of a Vercel build break.
  const [payload, weeklyBuySell, tickerDetail, institutional, trend, fundsList] = await Promise.all([
    api.signals({ throwOnError: false }),
    api.activity('weekly', { throwOnError: false }),
    searchQuery ? api.ticker(searchQuery) : Promise.resolve(null),
    api.institutional('daily', 12, { throwOnError: false }),
    api.institutionalTrend(12, { throwOnError: false }),
    api.funds({ throwOnError: false }),
  ]);
  // Signal-performance JSON is regenerated by the daily scrape workflow and
  // committed to public/data/. Reading it from disk (rather than via the API)
  // means the card works as soon as the file lands — no API deploy required.

  // Guard: if the API is unreachable (cold start, network blip), render an
  // empty-state shell rather than crashing the page.
  if (!payload) {
    return (
      <div className="min-h-dvh bg-canvas text-foreground p-6 font-sans flex items-center justify-center">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Data unavailable</h1>
          <p className="text-slate-400">
            The TickerTrace API didn&apos;t respond. Refresh in a moment — and if it
            keeps happening, let us know on the contact page.
          </p>
        </div>
      </div>
    );
  }

  const asOfDate = payload.asOfDate;
  const asOfFormatted = formatAsOfDate(asOfDate);
  const asOfLag = businessDaysBehind(asOfDate);
  const asOfIsStale = asOfLag > 1;
  const stats = totalsFor(payload.stats);
  const dailySignals: ApiSignals = payload.signals;
  const briefing: ApiBriefing = payload.briefing;
  const dailyBuySell: ApiActivity = payload.activity;
  const sectorFlow: FlatSectorEntry[] = flattenSectorFlow(payload.sectorFlow);
  const divergences: ApiDivergence[] = payload.divergences;

  return (
    <div className="min-h-dvh bg-canvas text-foreground p-6 space-y-6 font-sans">
      <KeyboardSearch />

      {/* Shared app navigation */}
      <SiteNav />

      {/* Status + KPI bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-surface border border-rule p-4 rounded-xl shadow-lg">
        <p className="text-sm text-slate-400 font-mono">
          LAST UPDATED:{' '}
          <span
            className={`px-2 py-0.5 rounded ${asOfIsStale ? 'text-amber-400 bg-amber-900/30' : 'text-white bg-slate-800'}`}
            title={asOfIsStale ? `Data is ${asOfLag} business ${asOfLag === 1 ? 'day' : 'days'} stale — scraper or sync may be delayed` : undefined}
          >
            {asOfFormatted}{asOfIsStale ? ' ⚠' : ''}
          </span>
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <KPICard title="Funds Tracked" value={stats.totalFunds.toString()} icon={<Layers className="h-4 w-4 text-equity" />} tooltip="Total institutional ETFs tracked daily across ARK, Avantis, Amplify, Corgi, YieldMax, Roundhill, Kurv, REX, NestYield, Sprott, and NicholasX. Full holdings normalized every trading day." />
          <KPICard title="Stocks" value={stats.totalStocks.toString()} icon={<Activity className="h-4 w-4 text-equity" />} tooltip="Unique stocks held across all tracked ETFs today — every equity position deduplicated across the full institutional book. The breadth of what these funds are watching." />
          <KPICard title="P/C Ratio" value={stats.pcRatio} icon={<PieChart className="h-4 w-4 text-equity" />} tooltip="Put/Call Ratio — option put contracts ÷ call contracts across tracked funds. Above 1.0 = more bearish hedging in the book; below 1.0 = more bullish call exposure." />
          {stats.newPositionsToday != null && (
            <KPICard title="New Today" value={stats.newPositionsToday.toString()} icon={<TrendingUp className="h-4 w-4 text-buy" />} tooltip="Brand-new fund positions opened today — tickers where a tracked fund went from 0 to holding something. A higher number means a more active day of institutional buying." />
          )}
          {stats.exitsToday != null && (
            <KPICard title="Exits Today" value={stats.exitsToday.toString()} icon={<TrendingDown className="h-4 w-4 text-rose-400" />} tooltip="Positions fully closed today — tickers where a tracked fund went from holding shares to zero. Pair with 'New Today' to gauge how much the institutional book is turning over." />
          )}
        </div>
      </div>

      {/* Ticker Search — promoted to its own row, full-width, with a label */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-equity" />
            Look up any ticker
          </h2>
          <span className="text-[10px] text-slate-500">
            See every fund holding it, weights, recent moves, options
          </span>
        </div>
        <TickerSearchForm />
      </div>

      {/* Ticker Detail (if searched) */}
      {searchQuery && <TickerDetailCard detail={tickerDetail} query={searchQuery} />}

      {/* Leaderboard home — what institutions as a whole are doing, plus the
          tracked-funds overview. The familiar "top buys/sells" landing view. */}
      {institutional && (
        <div className="flex items-center justify-end -mb-3">
          <Link href="/changes" className="text-xs text-equity hover:underline">
            Full changes & weekly/monthly view →
          </Link>
        </div>
      )}
      {institutional && <InstitutionalSummary flow={institutional} />}
      {trend && <InstitutionalTrend trend={trend} />}
      {fundsList?.funds && <FundsGrid funds={fundsList.funds} />}

      {/* Ask TickerTrace — Claude-powered chat over our own data */}
      <AskTickerTrace />

      {/* Did the signals work? — honest backtest */}

      {/* Pre-Market Briefing */}
      {briefing && <BriefingCard briefing={briefing} />}

      {/* Sector Flow + Signals Hero side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SignalsHero buying={dailySignals.buying} selling={dailySignals.selling} />
        </div>
        <SectorFlowCard flows={sectorFlow} />
      </div>

      {/* Divergences */}
      {divergences.length > 0 ? (
        <Collapsible defaultOpen={divergences.some(d => d.intrashop)}>
            <CollapsibleTrigger className="w-full">
              <Card className="bg-surface border-meta/20 text-slate-200 hover:bg-[#1a1a2e] transition-colors cursor-pointer">
                <CardHeader className="py-4">
                  <CardTitle className="text-md font-bold flex items-center justify-between">
                    <span className="flex items-center gap-2 text-meta">
                      <GitFork className="h-5 w-5" /> Divergences
                      <span className="text-xs font-normal text-slate-400">funds moving in opposite directions on the same ticker</span>
                      {divergences.some(d => d.intrashop) && (
                        <Badge variant="outline" className="text-orange-400 border-orange-400/30 bg-orange-400/10 text-[10px]">intra-shop conflict</Badge>
                      )}
                    </span>
                    <ChevronDown className="h-5 w-5 text-slate-400" />
                  </CardTitle>
                </CardHeader>
              </Card>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <Card className="bg-surface border-meta/20">
                <CardContent className="pt-4 space-y-3">
                  {divergences.map(d => <DivergenceRow key={d.ticker} divergence={d} />)}
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
      ) : (
        <Card className="bg-surface border-meta/20 text-slate-200">
          <CardHeader className="py-4">
            <CardTitle className="text-md font-bold flex items-center gap-2 text-meta">
              <GitFork className="h-5 w-5" /> Divergences
              <span className="text-xs font-normal text-slate-400">funds moving in opposite directions on the same ticker</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-sm text-slate-500 italic">No divergences today — all tracked funds are aligned on direction.</p>
          </CardContent>
        </Card>
      )}

      {/* Daily Activity — Heatmap + Table */}
      <Collapsible defaultOpen>
          <CollapsibleTrigger className="w-full">
            <Card className="bg-surface border-rule text-slate-200 hover:bg-surface-hover transition-colors cursor-pointer">
              <CardHeader className="py-4">
                <CardTitle className="text-lg font-bold flex items-center justify-between text-white">
                  <span className="flex items-center gap-2"><Eye className="h-5 w-5 text-equity" /> Daily Activity</span>
                  <ChevronDown className="h-5 w-5 text-slate-400" />
                </CardTitle>
              </CardHeader>
            </Card>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <Card className="bg-surface border-rule text-slate-200">
              <CardContent className="pt-6">
                <Tabs defaultValue="heatmap" className="w-full">
                  <TabsList className="bg-surface-alt border border-surface-elevated mb-4">
                    <TabsTrigger value="heatmap" className="data-[state=active]:bg-equity/10 data-[state=active]:text-equity">
                      🔥 Heatmap
                    </TabsTrigger>
                    <TabsTrigger value="table" className="data-[state=active]:bg-equity/10 data-[state=active]:text-equity">
                      📋 Table
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="heatmap">
                    {dailyBuySell ? (
                      <ActivityHeatmap
                        records={[
                          ...dailyBuySell.accumulating.map(r => ({ fund: r.fund, ticker: r.ticker, name: r.name, weightDelta: r.weightDelta, type: r.type })),
                          ...dailyBuySell.reducing.map(r => ({ fund: r.fund, ticker: r.ticker, name: r.name, weightDelta: r.weightDelta, type: r.type })),
                        ]}
                        providers={PROVIDER_ORDER}
                      />
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                        <Eye className="h-8 w-8 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No daily data yet</p>
                        <p className="text-xs mt-1 text-slate-600">Data updates on weekday mornings when the scraper runs.</p>
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="table">
                    <ActivityViewer data={dailyBuySell} timeframe="today" />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

      {/* Weekly Activity — Heatmap + Table */}
      <Collapsible>
        <CollapsibleTrigger className="w-full">
          <Card className="bg-surface border-rule text-slate-200 hover:bg-surface-hover transition-colors cursor-pointer">
            <CardHeader className="py-4">
              <CardTitle className="text-md font-bold flex items-center justify-between text-slate-400">
                <span className="flex items-center gap-2"><Layers className="h-5 w-5" /> Weekly Activity</span>
                <ChevronDown className="h-5 w-5" />
              </CardTitle>
            </CardHeader>
          </Card>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <Card className="bg-surface border-rule text-slate-200">
            <CardContent className="pt-6">
              <Tabs defaultValue="heatmap" className="w-full">
                <TabsList className="bg-surface-alt border border-surface-elevated mb-4">
                  <TabsTrigger value="heatmap" className="data-[state=active]:bg-equity/10 data-[state=active]:text-equity">
                    🔥 Heatmap
                  </TabsTrigger>
                  <TabsTrigger value="table" className="data-[state=active]:bg-equity/10 data-[state=active]:text-equity">
                    📋 Table
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="heatmap">
                  {weeklyBuySell ? (
                    <ActivityHeatmap
                      records={[
                        ...weeklyBuySell.accumulating.map(r => ({ fund: r.fund, ticker: r.ticker, name: r.name, weightDelta: r.weightDelta, type: r.type })),
                        ...weeklyBuySell.reducing.map(r => ({ fund: r.fund, ticker: r.ticker, name: r.name, weightDelta: r.weightDelta, type: r.type })),
                      ]}
                      providers={PROVIDER_ORDER}
                    />
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <p className="text-sm">No weekly data yet. Accumulates over the trading week.</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="table">
                  <ActivityViewer data={weeklyBuySell} timeframe="this week" />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Integrations & sharing — collapsed by default so config doesn't
          dominate prime real estate up top. Discord webhook + social share. */}
      <Collapsible>
        <CollapsibleTrigger className="w-full">
          <Card className="bg-surface border-rule text-slate-200 hover:bg-[#1a1a2e] transition-colors cursor-pointer">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between text-slate-400">
                <span className="flex items-center gap-2">
                  <Bell className="h-4 w-4" /> Integrations & sharing
                  <span className="text-xs font-normal text-slate-600">— Discord webhook, X / Reddit share</span>
                </span>
                <ChevronDown className="h-4 w-4" />
              </CardTitle>
            </CardHeader>
          </Card>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <Card className="bg-surface border-rule">
            <CardContent className="pt-4 space-y-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 text-[#5865F2]" /> Discord webhook
                </h3>
                <p className="text-[11px] text-slate-500 mb-2">
                  Paste a Discord channel webhook URL once and we&apos;ll post the daily briefing there every morning.
                </p>
                <DiscordWebhook
                  buyingSignals={dailySignals.buying}
                  sellingSignals={dailySignals.selling}
                  sectorFlow={sectorFlow}
                  asOfDate={asOfDate}
                />
              </div>
              <div className="border-t border-rule pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                  Share this dashboard
                </h3>
                <p className="text-[11px] text-slate-600 mb-3">
                  The Reddit button opens a text post with a real writeup — link posts to
                  the same domain get auto-flagged as advertising.
                </p>
                <ShareButtons
                  size="sm"
                  align="start"
                  url="https://tickertrace.pro/dashboard"
                  tweet={`${dailySignals.buying.length + dailySignals.selling.length} institutional ETF signals today. Top buys: ${dailySignals.buying.slice(0, 3).map(s => s.ticker).join(', ')}. See what the institutions are doing before the herd does.`}
                  redditTitle={`${dailySignals.buying.length + dailySignals.selling.length} institutional ETF position changes flagged today`}
                  redditText={[
                    `Ran today's scan of institutional ETF holdings — ${dailySignals.buying.length + dailySignals.selling.length} position changes worth a look. Top buys right now: ${dailySignals.buying.slice(0, 3).map(s => s.ticker).join(', ') || 'see the dashboard'}.`,
                    "",
                    "It's from a free tool I built that diffs fund holdings every morning — ARK, Avantis, YieldMax, Kurv and more. No signup: https://tickertrace.pro/dashboard",
                    "",
                    "Full disclosure: it's my project, and the data API is open. Sharing the signal because this sub might find it useful — happy to answer questions on the methodology.",
                  ].join("\n")}
                />
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPICard({ title, value, icon, tooltip }: { title: string; value: string; icon: React.ReactNode; tooltip?: string }) {
  return (
    <div className="bg-surface-alt border border-surface-elevated rounded-lg px-4 py-2 min-w-[120px]" title={tooltip}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">{title}</span>
        {icon}
      </div>
      <div className="text-xl font-bold font-mono text-white tracking-tight">{value}</div>
    </div>
  );
}

// ─── Divergence Row ───────────────────────────────────────────────────────────

function DivergenceRow({ divergence: d }: { divergence: ApiDivergence }) {
  // Tug-of-war: total buying pressure vs total selling pressure on this ticker.
  // The bar makes a lopsided fight ("everyone's buying, one fund is dumping")
  // readable at a glance instead of having to mentally sum the percentages.
  const totalBuy = d.buyingFunds.reduce((s, f) => s + Math.abs(f.weightDelta), 0);
  const totalSell = d.sellingFunds.reduce((s, f) => s + Math.abs(f.weightDelta), 0);
  const buyPct = totalBuy + totalSell > 0 ? (totalBuy / (totalBuy + totalSell)) * 100 : 50;
  return (
    <div className={`rounded-lg border px-4 py-3 ${d.intrashop ? 'border-orange-400/30 bg-orange-400/5' : 'border-meta/20 bg-meta/5'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Buying side */}
        <div className="flex flex-wrap gap-1">
          {d.buyingFunds.map(f => (
            <span key={f.fund} className="flex items-center gap-1">
              <Badge variant="outline" className={`font-mono text-[10px] px-1.5 py-0 ${getETFColor(f.fund)}`}>{f.fund}</Badge>
              <span className="text-[10px] text-buy font-mono">+{f.weightDelta.toFixed(2)}%</span>
            </span>
          ))}
        </div>

        {/* Center: ticker + label */}
        <div className="flex items-center gap-2 mx-auto">
          <ArrowUpRight className="h-3 w-3 text-buy" />
          <Link href={`/stocks/${d.ticker}`} title={`See ${d.ticker} institutional detail`} className="font-mono font-bold text-white hover:text-equity transition-colors">{d.ticker}</Link>
          <span className="text-[10px] text-slate-500 max-w-[120px] truncate">{d.name}</span>
          <ArrowDownRight className="h-3 w-3 text-sell" />
          {d.intrashop && (
            <Badge variant="outline" className="text-orange-400 border-orange-400/30 bg-orange-400/10 text-[10px] ml-1">INTRA-SHOP</Badge>
          )}
        </div>

        {/* Selling side */}
        <div className="flex flex-wrap gap-1 justify-end">
          {d.sellingFunds.map(f => (
            <span key={f.fund} className="flex items-center gap-1">
              <Badge variant="outline" className={`font-mono text-[10px] px-1.5 py-0 ${getETFColor(f.fund)}`}>{f.fund}</Badge>
              <span className="text-[10px] text-sell font-mono">{f.weightDelta.toFixed(2)}%</span>
            </span>
          ))}
        </div>
      </div>

      {/* Tug-of-war bar — total buy pressure vs total sell pressure */}
      <div className="flex items-center gap-2 mt-2.5">
        <span className="text-[10px] font-mono text-buy shrink-0 w-14 text-right">+{totalBuy.toFixed(2)}%</span>
        <div className="flex-1 h-2 rounded-full overflow-hidden bg-rule flex">
          <div className="h-full bg-buy/80" style={{ width: `${buyPct}%` }} />
          <div className="h-full bg-sell/80" style={{ width: `${100 - buyPct}%` }} />
        </div>
        <span className="text-[10px] font-mono text-sell shrink-0 w-14">-{totalSell.toFixed(2)}%</span>
      </div>
    </div>
  );
}

// ─── Ticker Detail ───────────────────────────────────────────────────────────

function TickerDetailCard({ detail, query }: { detail: ApiTickerDetail | null; query: string }) {
  if (!detail) {
    return (
      <Card className="bg-surface border-sell/20">
        <CardContent className="py-6 text-center">
          <Search className="h-8 w-8 mx-auto mb-3 text-slate-500 opacity-40" />
          <p className="text-slate-400">No holdings found for <span className="font-mono text-white">{query}</span> across tracked funds.</p>
        </CardContent>
      </Card>
    );
  }

  // Split holdings into stock positions and options. They render as separate
  // sub-sections so a fund holding both the stock AND a few option contracts
  // doesn't look like "ULTY listed 5 times" — it's clearly 1 stock + 4
  // contracts.
  const stockHoldings = detail.holdings.filter(h => !h.isOption);
  const optionHoldings = detail.holdings.filter(h => h.isOption && h.optionDetails);

  return (
    <Card className="bg-gradient-to-r from-surface to-surface-gradient border-equity/20 shadow-lg shadow-equity/5">
      <CardHeader className="pb-3 border-b border-rule">
        <CardTitle className="text-lg font-bold flex items-center gap-3 text-white">
          <Search className="h-5 w-5 text-equity" />
          <Link href={`/stocks/${detail.ticker}`} className="font-mono text-equity hover:underline" title={`Full analysis for ${detail.ticker}`}>{detail.ticker}</Link>
          <span className="text-sm font-normal text-slate-400">{detail.name}</span>
          <Badge variant="outline" className="text-equity border-equity/30 ml-auto">
            {detail.fundCount} fund{detail.fundCount !== 1 ? 's' : ''} holding
          </Badge>
        </CardTitle>
        <p className="text-[11px] text-slate-500 mt-1">
          Click the ticker for the full analysis page · click a fund badge to open its profile
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current Holdings — split into Stock + Options sections */}
          <div className="space-y-4">
            {/* Stock positions */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                Stock positions <span className="text-slate-600 normal-case">· {stockHoldings.length}</span>
              </h3>
              {stockHoldings.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-1">No direct equity exposure.</p>
              ) : (
                <div className="space-y-1.5">
                  {stockHoldings.map((h, i) => (
                    <div key={i} className="flex items-center justify-between bg-surface-alt rounded px-3 py-2 border border-rule hover:border-equity/30 transition-colors">
                      <Link href={`/fund/${h.fund}`} title={`Open ${h.fund} profile`}>
                        <Badge variant="outline" className={`font-mono text-[10px] px-1.5 py-0 ${getETFColor(h.fund)} cursor-pointer hover:opacity-80 transition-opacity`}>{h.fund}</Badge>
                      </Link>
                      <div className="text-right">
                        <span className="text-xs font-mono text-white">{h.weight.toFixed(3)}%</span>
                        <span className="text-[10px] text-slate-500 ml-2">{h.shares.toLocaleString()} shs</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Options exposure */}
            {optionHoldings.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                  Options exposure <span className="text-slate-600 normal-case">· {optionHoldings.length} contract{optionHoldings.length !== 1 ? 's' : ''}</span>
                </h3>
                <div className="space-y-1.5">
                  {optionHoldings.map((h, i) => {
                    const isCall = h.optionDetails!.type.toLowerCase().startsWith('c');
                    const isShort = h.shares < 0;
                    // Share Quantity on an option row is the signed contract count
                    // (negative = written/short). Show the magnitude — the sign is
                    // already carried by the +/− badge prefix and the weight color.
                    const contracts = Math.abs(Math.round(h.shares));
                    return (
                      <div key={i} className="flex items-center justify-between bg-surface-alt rounded px-3 py-2 border border-rule hover:border-equity/30 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link href={`/fund/${h.fund}`} title={`Open ${h.fund} profile`}>
                            <Badge variant="outline" className={`font-mono text-[10px] px-1.5 py-0 ${getETFColor(h.fund)} cursor-pointer hover:opacity-80 transition-opacity`}>{h.fund}</Badge>
                          </Link>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-mono ${isCall ? 'text-warning border-warning/30' : 'text-buy border-buy/30'}`}>
                            {isShort ? '−' : '+'}{isCall ? 'C' : 'P'} ${h.optionDetails!.strike}
                          </Badge>
                          <span className="text-[10px] text-slate-500 font-mono truncate">{h.optionDetails!.expiry}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-xs font-mono ${h.weight >= 0 ? 'text-white' : 'text-[#ff8888]'}`}>
                            {h.weight >= 0 ? '+' : ''}{h.weight.toFixed(4)}%
                          </span>
                          {contracts > 0 && (
                            <span className="text-[10px] text-slate-500 ml-2">{contracts.toLocaleString()} contract{contracts !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Recent Changes */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Recent Changes</h3>
            {detail.changes.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4">No changes in the latest period</p>
            ) : (
              <div className="space-y-1.5">
                {detail.changes.map((c, i) => (
                  <div key={i} className="flex items-center justify-between bg-surface-alt rounded px-3 py-2 border border-rule hover:border-equity/30 transition-colors">
                    <div className="flex items-center gap-2">
                      <Link href={`/fund/${c.fund}`} title={`Open ${c.fund} profile`}>
                        <Badge variant="outline" className={`font-mono text-[10px] px-1.5 py-0 ${getETFColor(c.fund)} cursor-pointer hover:opacity-80 transition-opacity`}>{c.fund}</Badge>
                      </Link>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${c.type === 'NEW' ? 'text-buy border-buy/30' :
                        c.type === 'REMOVED' ? 'text-sell border-sell/30' :
                          'text-equity border-equity/30'
                        }`}>{c.type}</Badge>
                    </div>
                    <span className={`text-xs font-mono ${(c.activeWeightDelta ?? c.weightDelta) > 0 ? 'text-buy' : 'text-sell'}`}>
                      {(c.activeWeightDelta ?? c.weightDelta) > 0 ? '+' : ''}{(c.activeWeightDelta ?? c.weightDelta).toFixed(3)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Signal Performance (backtest) ───────────────────────────────────────────

// ─── Sector Flow ─────────────────────────────────────────────────────────────

function SectorFlowCard({ flows }: { flows: FlatSectorEntry[] }) {
  if (flows.length === 0) {
    return (
      <Card className="bg-surface border-rule">
        <CardContent className="py-8 text-center text-slate-500">
          <BarChart3 className="h-8 w-8 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No sector flow data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const inflowing = flows.filter(f => f.weightDelta > 0);
  const outflowing = flows.filter(f => f.weightDelta < 0);

  return (
    <Card className="bg-surface border-rule">
      <CardHeader className="pb-3 border-b border-rule">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
          <BarChart3 className="h-5 w-5 text-equity" /> Sector Flow
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        {inflowing.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-buy mb-1.5">Money Flowing In</h4>
            {inflowing.slice(0, 5).map(f => (
              <SectorBar key={f.sector} flow={f} />
            ))}
          </div>
        )}
        {outflowing.length > 0 && (
          <div className="mt-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-sell mb-1.5">Money Flowing Out</h4>
            {outflowing.slice(0, 5).map(f => (
              <SectorBar key={f.sector} flow={f} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SectorBar({ flow }: { flow: FlatSectorEntry }) {
  const isInflow = flow.weightDelta > 0;
  const color = isInflow ? 'bg-buy' : 'bg-sell';
  const textColor = isInflow ? 'text-buy' : 'text-sell';
  const maxWidth = Math.min(Math.abs(flow.weightDelta) * 5, 100); // scale bar

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[10px] text-slate-400 w-[110px] truncate uppercase" title={flow.sector}>
        {flow.sector}
      </span>
      <div className="flex-1 bg-rule rounded-full h-2 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${maxWidth}%`, opacity: 0.7 }} />
      </div>
      <span className={`text-[10px] font-mono min-w-[50px] text-right ${textColor}`}>
        {isInflow ? '+' : ''}{flow.weightDelta.toFixed(2)}%
      </span>
    </div>
  );
}

// ─── Pre-Market Briefing ─────────────────────────────────────────────────────

function BriefingCard({ briefing }: { briefing: ApiBriefing }) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="w-full">
        <Card className="bg-gradient-to-r from-surface via-surface-gradient to-surface border-equity/20 shadow-lg shadow-equity/5 hover:border-equity/30 transition-colors cursor-pointer">
          <CardHeader className="py-4">
            <CardTitle className="text-lg font-bold flex items-center justify-between text-white">
              <span className="flex items-center gap-2">
                <Target className="h-5 w-5 text-equity" /> Retail Intel Briefing
                <span className="text-xs font-normal text-slate-500">What you need to know before the bell</span>
              </span>
              <ChevronDown className="h-5 w-5 text-slate-400" />
            </CardTitle>
          </CardHeader>
        </Card>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <Card className="bg-gradient-to-r from-surface via-surface-gradient to-surface border-equity/20">
          <CardContent className="pt-4">
            <BriefingContent briefing={briefing} />
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

function BriefingContent({ briefing }: { briefing: ApiBriefing }) {
  const hasCrossFund = briefing.crossFundConvergence.length > 0;
  const hasStreaks = briefing.activeStreaks.length > 0;
  const hasOptions = briefing.notableOptions.length > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Top Buys */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-buy flex items-center gap-1">
          <TrendingUp className="h-3 w-3" /> Top Buys
        </h3>
        {briefing.topBuys.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No significant buys</p>
        ) : briefing.topBuys.map(s => (
          <Link
            key={s.ticker}
            href={`/stocks/${s.ticker}`}
            title={`See ${s.ticker} institutional detail`}
            className="flex items-center justify-between bg-buy/5 rounded px-2 py-1.5 border border-buy/10 hover:bg-buy/10 hover:border-buy/30 transition-colors"
          >
            <div>
              <span className="font-mono font-bold text-sm text-white">{s.ticker}</span>
              {s.streak && s.streak >= 2 && (
                <span className="ml-1.5 text-[10px] text-orange-400">🔥{s.streak}d</span>
              )}
              <div className="text-[10px] text-slate-500">{s.fundDetails.map(f => f.fund).join(', ')}</div>
              {s.sector && (
                <span className="inline-block mt-0.5 text-[9px] font-medium px-1.5 py-0 rounded border border-rule-strong bg-surface-elevated text-slate-500 leading-4">{s.sector}</span>
              )}
            </div>
            <div className="text-right">
              <span className="text-xs font-mono text-buy">+{s.totalWeightDelta.toFixed(2)}%</span>
              {estimateSignalDollars(s) && (
                <div className="text-[10px] text-buy/50 font-mono">{estimateSignalDollars(s)}</div>
              )}
              <div className="text-[10px] text-slate-600" title="Conviction score: (# funds) × (weight % moved) × (avg fund AUM). Higher = more institutional weight behind this move.">conv {s.convictionScore.toFixed(1)}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Top Sells */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-sell flex items-center gap-1">
          <TrendingDown className="h-3 w-3" /> Top Sells
        </h3>
        {briefing.topSells.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No significant sells</p>
        ) : briefing.topSells.map(s => (
          <Link
            key={s.ticker}
            href={`/stocks/${s.ticker}`}
            title={`See ${s.ticker} institutional detail`}
            className="flex items-center justify-between bg-sell/5 rounded px-2 py-1.5 border border-sell/10 hover:bg-sell/10 hover:border-sell/30 transition-colors"
          >
            <div>
              <span className="font-mono font-bold text-sm text-white">{s.ticker}</span>
              {s.streak && s.streak >= 2 && (
                <span className="ml-1.5 text-[10px] text-orange-400">🔥{s.streak}d</span>
              )}
              <div className="text-[10px] text-slate-500">{s.fundDetails.map(f => f.fund).join(', ')}</div>
              {s.sector && (
                <span className="inline-block mt-0.5 text-[9px] font-medium px-1.5 py-0 rounded border border-rule-strong bg-surface-elevated text-slate-500 leading-4">{s.sector}</span>
              )}
            </div>
            <div className="text-right">
              <span className="text-xs font-mono text-sell">{s.totalWeightDelta.toFixed(2)}%</span>
              {estimateSignalDollars(s) && (
                <div className="text-[10px] text-sell/50 font-mono">{estimateSignalDollars(s)}</div>
              )}
              <div className="text-[10px] text-slate-600" title="Conviction score: (# funds) × (weight % moved) × (avg fund AUM). Higher = more institutional weight behind this move.">conv {s.convictionScore.toFixed(1)}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Cross-Fund Convergence */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-meta flex items-center gap-1">
          <Crosshair className="h-3 w-3" /> Multi-Provider
        </h3>
        {!hasCrossFund ? (
          <p className="text-xs text-slate-500 italic">No cross-provider signals</p>
        ) : briefing.crossFundConvergence.map(s => (
          <Link
            key={s.ticker}
            href={`/stocks/${s.ticker}`}
            title={`See ${s.ticker} institutional detail`}
            className="flex items-center justify-between bg-meta/5 rounded px-2 py-1.5 border border-meta/10 hover:bg-meta/10 hover:border-meta/30 transition-colors"
          >
            <div>
              <span className="font-mono font-bold text-sm text-white">{s.ticker}</span>
              <div className="text-[10px] text-slate-500">{s.providerCount} providers</div>
            </div>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.direction === 'buying' ? 'text-buy border-buy/30' : 'text-sell border-sell/30'}`}>
              {s.direction.toUpperCase()}
            </Badge>
          </Link>
        ))}
      </div>

      {/* Streaks & Options */}
      <div className="space-y-2">
        {hasStreaks && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-orange-400 flex items-center gap-1">
              <Flame className="h-3 w-3" /> Active Streaks
            </h3>
            {briefing.activeStreaks.slice(0, 3).map(s => (
              <Link
                key={`${s.fund}-${s.ticker}`}
                href={`/stocks/${s.ticker}`}
                title={`See ${s.ticker} institutional detail`}
                className="flex items-center justify-between bg-orange-500/5 rounded px-2 py-1.5 border border-orange-500/10 hover:bg-orange-500/10 hover:border-orange-500/30 transition-colors"
              >
                <div>
                  <span className="font-mono font-bold text-sm text-white">{s.ticker}</span>
                  <div className="text-[10px] text-slate-500">{s.fund}</div>
                </div>
                <span className="text-xs font-mono text-orange-400">🔥 {s.days}d {s.direction === 'up' ? '↑' : '↓'}</span>
              </Link>
            ))}
          </>
        )}
        {hasOptions && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-warning flex items-center gap-1 mt-2">
              <Zap className="h-3 w-3" /> New Options
            </h3>
            {briefing.notableOptions.slice(0, 2).map((o, i) => (
              <Link
                key={i}
                href={`/stocks/${o.record.optionDetails?.underlying ?? o.record.ticker}`}
                title={`See ${o.record.optionDetails?.underlying ?? o.record.ticker} institutional detail`}
                className="block bg-warning/5 rounded px-2 py-1.5 border border-warning/10 hover:bg-warning/10 hover:border-warning/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm text-white">{o.record.ticker}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-warning border-warning/30">{o.record.fund}</Badge>
                </div>
                <p className="text-[10px] text-warning mt-0.5">{o.signal.directionalView}</p>
              </Link>
            ))}
          </>
        )}
        {!hasStreaks && !hasOptions && (
          <p className="text-xs text-slate-500 italic">No streaks or notable options today</p>
        )}
      </div>
    </div>
  );
}

// ─── Hero: Institutional Buying Signals ──────────────────────────────────────

function SignalsHero({ buying, selling }: { buying: ApiSignal[]; selling: ApiSignal[] }) {
  if (buying.length === 0 && selling.length === 0) {
    return (
      <Card className="bg-surface border-rule">
        <CardContent className="py-12 text-center text-slate-500">
          <Zap className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>No significant signals yet.</p>
        </CardContent>
      </Card>
    );
  }

  const topBuying = buying.slice(0, 8);
  const topSelling = selling.slice(0, 8);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="bg-gradient-to-br from-[#0a1a0f] to-surface border-buy/20">
        <CardHeader className="pb-3 border-b border-rule">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-buy">
            <TrendingUp className="h-5 w-5" /> Buying
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {topBuying.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No significant buying</p>
          ) : (
            <div className="space-y-2">
              {topBuying.map((s, i) => <SignalRow key={s.ticker} signal={s} rank={i + 1} />)}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-[#1a0a0a] to-surface border-sell/20">
        <CardHeader className="pb-3 border-b border-rule">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-sell">
            <TrendingDown className="h-5 w-5" /> Selling
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {topSelling.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No significant selling</p>
          ) : (
            <div className="space-y-2">
              {topSelling.map((s, i) => <SignalRow key={s.ticker} signal={s} rank={i + 1} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SignalRow({ signal, rank }: { signal: ApiSignal; rank: number }) {
  const isBuying = signal.direction === 'buying';
  const color = isBuying ? 'text-buy' : 'text-sell';
  const bgColor = isBuying ? 'bg-buy/5' : 'bg-sell/5';

  return (
    <div className={`flex items-center gap-3 ${bgColor} rounded-lg px-3 py-2.5 border border-rule hover:border-rule-strong transition-colors`}>
      <span className="text-xs font-mono text-slate-500 w-5 text-right">#{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/stocks/${signal.ticker}`} title={`See ${signal.ticker} institutional detail`} className="font-mono font-bold text-white text-sm hover:text-equity transition-colors">{signal.ticker}</Link>
          {signal.providerCount >= 2 && (
            <Badge variant="outline" className="text-meta border-meta/30 bg-meta/10 text-[10px] px-1.5 py-0" title={`${signal.providerCount} distinct fund families moving this ticker — cross-family conviction`}>
              {signal.providerCount} fam
            </Badge>
          )}
          {signal.streak && signal.streak >= 2 && (
            <span className="text-[10px] text-orange-400 font-semibold">🔥{signal.streak}d</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs text-slate-500 truncate max-w-[160px]">{signal.name}</p>
          {signal.sector && (
            <span className="text-[9px] font-medium px-1.5 py-0 rounded border border-rule-strong bg-surface-elevated text-slate-500 leading-4 shrink-0">{signal.sector}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex flex-wrap gap-1 justify-end max-w-[100px]">
          {signal.fundDetails.map(f => (
            <FundBadge key={f.fund} fund={f.fund} />
          ))}
        </div>
        <div className="text-right min-w-[60px]">
          <span className={`font-mono text-sm font-semibold ${color} flex items-center gap-0.5 justify-end`}>
            {isBuying ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {isBuying ? '+' : ''}{signal.totalWeightDelta.toFixed(2)}%
          </span>
          {estimateSignalDollars(signal) && (
            <div className={`text-[10px] font-mono ${isBuying ? 'text-buy/50' : 'text-sell/50'}`}>{estimateSignalDollars(signal)}</div>
          )}
          <div className="text-[10px] text-slate-600 font-mono" title="Conviction score: (# funds) × (weight % moved) × (avg fund AUM). Higher = more institutional weight behind this move.">conv {signal.convictionScore.toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Activity Viewer ─────────────────────────────────────────────────────────

function ActivityViewer({ data, timeframe }: { data: ApiActivity | null; timeframe: string }) {
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
        <Layers className="h-12 w-12 mb-4 opacity-20" />
        <p>No prior data yet for {timeframe}.</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="accumulating" className="w-full">
      <TabsList className="bg-surface-alt border border-surface-elevated mb-6">
        <TabsTrigger value="accumulating" className="data-[state=active]:bg-buy/10 data-[state=active]:text-buy">
          <TrendingUp className="w-4 h-4 mr-2" /> ACCUMULATING ({data.accumulating.length})
        </TabsTrigger>
        <TabsTrigger value="reducing" className="data-[state=active]:bg-sell/10 data-[state=active]:text-sell">
          <TrendingDown className="w-4 h-4 mr-2" /> REDUCING ({data.reducing.length})
        </TabsTrigger>
        <TabsTrigger value="options" className="data-[state=active]:bg-warning/10 data-[state=active]:text-warning">
          <Zap className="w-4 h-4 mr-2" /> OPTIONS ({data.optionsActivity.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="accumulating">
        <ProviderGroupedTable records={data.accumulating} direction="accumulating" />
      </TabsContent>
      <TabsContent value="reducing">
        <ProviderGroupedTable records={data.reducing} direction="reducing" />
      </TabsContent>
      <TabsContent value="options">
        <OptionsTable records={data.optionsActivity} />
      </TabsContent>
    </Tabs>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────

// groupByProvider now lives in components/options-table.tsx (imported above)
// so the dashboard and OptionsTable share one bucketing implementation.

function ProviderGroupedTable({ records, direction }: { records: ApiChangeRecord[]; direction: string }) {
  if (records.length === 0) return <div className="text-slate-500 py-8 text-center italic">No significant {direction} positions.</div>;
  const groups = groupByProvider(records);
  return (
    <div className="space-y-6">
      {groups.map(({ provider, records: provRecords }) => (
        <div key={provider}>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{provider}</span>
            <span className="text-xs text-slate-600 font-mono">({provRecords.length})</span>
            <div className="flex-1 border-t border-rule ml-2" />
          </div>
          <EquityTable records={provRecords} />
        </div>
      ))}
    </div>
  );
}

// getETFColor now lives in lib/providers.ts (imported above) — shared with
// components/options-table.tsx rather than duplicated.

function FundBadge({ fund }: { fund: string }) {
  return (
    <Link href={`/fund/${fund}`}>
      <Badge variant="outline" className={`font-mono border cursor-pointer hover:opacity-80 transition-opacity ${getETFColor(fund)}`}>{fund}</Badge>
    </Link>
  );
}

// Mobile priority: ticker, signal and weight Δ are load-bearing (table-fork
// lens — direction + active-weight delta always survive to 375px); fund,
// name and share counts are supporting detail that return at sm/md/lg.
//
// `page.tsx` is a Server Component, so DataTable (a Client Component) can
// only receive pre-rendered ReactNode cells, not `(row) => ReactNode`
// functions — those don't survive the RSC boundary. Cells are rendered here,
// server-side, once per row.
const equityColumns: DataTableColumn[] = [
  { key: 'fund', header: 'Fund', mobilePriority: 'sm' },
  { key: 'ticker', header: 'Ticker' },
  { key: 'name', header: 'Name', mobilePriority: 'md' },
  { key: 'signal', header: 'Signal', align: 'center' },
  { key: 'shares', header: 'Shares', align: 'right', mobilePriority: 'lg' },
  { key: 'weightDelta', header: 'Weight Δ', align: 'right' },
];

function EquityTable({ records }: { records: ApiChangeRecord[] }) {
  const rows: DataTableRow[] = records.map((r, i) => {
    const delta = r.activeWeightDelta ?? r.weightDelta;
    return {
      key: `${r.fund}-${r.ticker}-${i}`,
      cells: {
        fund: <FundBadge fund={r.fund} />,
        ticker: (
          <span className="font-mono font-medium">
            <Link href={`/stocks/${r.ticker}`} className="text-equity hover:underline">{r.ticker}</Link>
          </span>
        ),
        name: (
          <div className="max-w-[200px] text-slate-400">
            <span className="block truncate text-xs" title={r.name}>{r.name}</span>
            {r.sector && !r.isOption && (
              <span className="inline-block mt-0.5 text-[9px] font-medium px-1.5 py-0 rounded border border-rule-strong bg-surface-elevated text-slate-500 leading-4">
                {r.sector}
              </span>
            )}
          </div>
        ),
        signal: r.type === 'NEW' ? <Badge variant="outline" className="text-buy border-buy/40 bg-buy/10 font-semibold">NEW</Badge>
          : r.type === 'REMOVED' ? <Badge variant="outline" className="text-sell border-sell/40 bg-sell/10 font-semibold">EXITED</Badge>
            : delta > 0 ? <Badge variant="outline" className="text-equity border-equity/40 bg-equity/10">ADDING</Badge>
              : <Badge variant="outline" className="text-warning border-warning/40 bg-warning/10">TRIMMING</Badge>,
        shares: (
          <div className="flex flex-col items-end font-mono text-slate-300">
            <span>{(r.currentShares ?? 0).toLocaleString()}</span>
            {(r.previousShares ?? 0) > 0 && r.type !== 'REMOVED' && <span className="text-xs text-slate-500 line-through">{(r.previousShares ?? 0).toLocaleString()}</span>}
          </div>
        ),
        weightDelta: (
          <span className={`flex items-center justify-end gap-1 font-mono ${delta > 0 ? 'text-buy' : delta < 0 ? 'text-sell' : 'text-slate-400'}`}>
            {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : delta < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
            {delta > 0 ? '+' : ''}{delta.toFixed(3)}%
          </span>
        ),
      },
    };
  });
  return (
    <DataTable
      columns={equityColumns}
      rows={rows}
      wrapperClassName="mb-2"
    />
  );
}

