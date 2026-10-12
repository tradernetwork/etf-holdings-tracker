'use client';

import { useMemo, useState } from 'react';
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/data-table';
import {
    ArrowUpRight, ArrowDownRight, ArrowUpDown, ArrowUp, ArrowDown,
    Search, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, X, Layers,
} from 'lucide-react';
import Link from 'next/link';
import { FUND_PROVIDERS, FUND_AUM } from '@/lib/providers';
import { FlowChip } from '@/components/flow-chip';

interface Change {
    fund: string;
    ticker: string;
    name: string;
    type: string;
    weightDelta: number;
    activeWeightDelta?: number;
    isOption: boolean;
    sector?: string;
    underlying?: string;
}

/** Per-ticker aggregate — all fund-level equity changes rolled up. */
interface TickerAgg {
    ticker: string;
    name: string;
    sector?: string;
    fundsBuying: string[];
    fundsSelling: string[];
    fundsNew: string[];
    fundsExited: string[];
    netDelta: number;
    totalAbsDelta: number;
    netDollarM: number;
}

const PAGE_SIZE = 50;

/** Translate a weight-delta percentage into an estimated dollar value using
 *  the fund's known AUM. Returns null for options (notional is different) or
 *  unknown/zero AUM. */
function estimateDollars(weightDeltaPct: number, fund: string, isOption: boolean): string | null {
    if (isOption) return null;
    const aumB = FUND_AUM[fund];
    if (!aumB || weightDeltaPct === 0) return null;
    const dollarM = Math.abs(weightDeltaPct) / 100 * aumB * 1000;
    if (dollarM < 0.1) return null;  // too small to be meaningful
    if (dollarM >= 1000) return `≈ $${(dollarM / 1000).toFixed(1)}B`;
    if (dollarM >= 1) return `≈ $${dollarM.toFixed(1)}M`;
    return `≈ $${Math.round(dollarM * 1000)}k`;
}

/** Format a signed AUM-weighted net dollar flow as "≈ +$210M" or "≈ -$45M". */
function fmtNetDollar(m: number): string | null {
    const abs = Math.abs(m);
    if (abs < 0.5) return null;
    const sign = m >= 0 ? '+' : '';
    if (abs >= 1000) return `≈ ${sign}$${(abs / 1000).toFixed(1)}B`;
    if (abs >= 1) return `≈ ${sign}$${abs.toFixed(1)}M`;
    return `≈ ${sign}$${Math.round(abs * 1000)}k`;
}

export function ChangesClient({ changes, providers }: {
    changes: Change[];
    asOfDate: string;
    providers: string[];
}) {
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
    const [selectedFund, setSelectedFund] = useState<string | null>(null);
    const [selectedSector, setSelectedSector] = useState<string | null>(null);
    const [showType, setShowType] = useState<'all' | 'buys' | 'sells' | 'new' | 'exit'>('all');
    const [search, setSearch] = useState('');
    const [groupByTicker, setGroupByTicker] = useState(false);
    const [sorting, setSorting] = useState<SortingState>([
        // Default: largest absolute weight delta first.
        { id: 'weightDelta', desc: true },
    ]);

    // Provider/fund filtering — used as the base for both type counts and the
    // fully-filtered list. Separated so we can count each type bucket before
    // the type filter collapses the data down to one category.
    const providerFiltered = useMemo(() => {
        let rows = changes;
        if (selectedProvider) {
            rows = rows.filter(c => (FUND_PROVIDERS[c.fund] ?? c.fund) === selectedProvider);
        }
        if (selectedFund) {
            rows = rows.filter(c => c.fund === selectedFund);
        }
        return rows;
    }, [changes, selectedProvider, selectedFund]);

    // Unique non-empty sectors from the provider-filtered equity changes.
    // Options don't carry a meaningful sector label, so they're excluded here.
    const allSectors = useMemo(() => {
        const s = new Set<string>();
        providerFiltered.forEach(c => { if (!c.isOption && c.sector) s.add(c.sector); });
        return [...s].sort();
    }, [providerFiltered]);

    // Per-sector change count — tells each pill "how many you'd see if you clicked me."
    const sectorCounts = useMemo(() => {
        const m = new Map<string, number>();
        providerFiltered.forEach(c => {
            if (!c.isOption && c.sector) m.set(c.sector, (m.get(c.sector) ?? 0) + 1);
        });
        return m;
    }, [providerFiltered]);

    // Sector filter applied after provider/fund but before type — keeps the
    // type-count buckets honest for the selected sector.
    const sectorFiltered = useMemo(() => {
        if (!selectedSector) return providerFiltered;
        return providerFiltered.filter(c => c.sector === selectedSector);
    }, [providerFiltered, selectedSector]);

    // Counts per type bucket — answers "how many rows would I see if I clicked
    // this button?" given the current provider/fund/sector selection.
    const typeCounts = useMemo(() => ({
        all: sectorFiltered.length,
        buys: sectorFiltered.filter(c => (c.activeWeightDelta ?? c.weightDelta) > 0 && c.type !== 'NEW').length,
        sells: sectorFiltered.filter(c => (c.activeWeightDelta ?? c.weightDelta) < 0 && c.type !== 'REMOVED').length,
        new: sectorFiltered.filter(c => c.type === 'NEW').length,
        exit: sectorFiltered.filter(c => c.type === 'REMOVED').length,
    }), [sectorFiltered]);

    // Apply the pill filters (provider / fund / sector / type) BEFORE handing off to
    // TanStack — these are coarse audience filters, not column-level. TanStack
    // then handles per-column sort + the global text search + pagination.
    const preFiltered = useMemo(() => {
        let rows = sectorFiltered;
        if (showType === 'buys') rows = rows.filter(c => (c.activeWeightDelta ?? c.weightDelta) > 0 && c.type !== 'NEW');
        else if (showType === 'sells') rows = rows.filter(c => (c.activeWeightDelta ?? c.weightDelta) < 0 && c.type !== 'REMOVED');
        else if (showType === 'new') rows = rows.filter(c => c.type === 'NEW');
        else if (showType === 'exit') rows = rows.filter(c => c.type === 'REMOVED');
        return rows;
    }, [sectorFiltered, showType]);

    // Aggregate equity changes by ticker for the "group by ticker" view.
    // Options are excluded — they can't be meaningfully collapsed with equity
    // by the same ticker symbol (TSLA the stock vs TSLA calls are different things).
    // The search filter is applied after aggregation so you can type "NVDA" and
    // see the single rolled-up NVDA row instead of scrolling past 6 fund entries.
    const tickerAggs = useMemo((): TickerAgg[] => {
        if (!groupByTicker) return [];
        const map = new Map<string, TickerAgg>();
        for (const c of preFiltered) {
            if (c.isOption) continue;
            const delta = c.activeWeightDelta ?? c.weightDelta;
            if (!map.has(c.ticker)) {
                map.set(c.ticker, {
                    ticker: c.ticker, name: c.name, sector: c.sector,
                    fundsBuying: [], fundsSelling: [], fundsNew: [], fundsExited: [],
                    netDelta: 0, totalAbsDelta: 0, netDollarM: 0,
                });
            }
            const agg = map.get(c.ticker)!;
            agg.netDelta += delta;
            agg.totalAbsDelta += Math.abs(delta);
            if (c.type === 'NEW') agg.fundsNew.push(c.fund);
            else if (c.type === 'REMOVED') agg.fundsExited.push(c.fund);
            else if (delta > 0) agg.fundsBuying.push(c.fund);
            else if (delta < 0) agg.fundsSelling.push(c.fund);
            const aumB = FUND_AUM[c.fund];
            if (aumB) agg.netDollarM += delta / 100 * aumB * 1000;
        }
        let rows = [...map.values()].sort((a, b) => b.totalAbsDelta - a.totalAbsDelta);
        if (search) {
            const q = search.toUpperCase();
            rows = rows.filter(r => r.ticker.includes(q) || r.name.toUpperCase().includes(q));
        }
        return rows;
    }, [groupByTicker, preFiltered, search]);

    const columns = useMemo<ColumnDef<Change>[]>(() => [
        {
            accessorKey: 'ticker',
            header: 'Ticker',
            cell: ({ row }) => {
                const { ticker, isOption, underlying } = row.original;
                const href = isOption
                    ? (underlying ? `/stocks/${underlying}` : null)
                    : `/stocks/${ticker}`;
                return (
                    <div className="flex items-center gap-1.5">
                        {href ? (
                            <Link href={href} className="font-mono font-bold text-equity hover:underline">
                                {ticker}
                            </Link>
                        ) : (
                            <span className="font-mono font-bold text-slate-400">{ticker}</span>
                        )}
                        {isOption && <span className="text-[10px] text-slate-500" title="Option contract">⚡</span>}
                    </div>
                );
            },
        },
        {
            accessorKey: 'name',
            header: 'Name',
            cell: ({ row }) => (
                <div className="max-w-[240px]">
                    <span className="text-slate-400 text-xs block truncate">{row.original.name}</span>
                    {row.original.sector && !row.original.isOption && (
                        <span className="inline-block mt-0.5 text-[9px] font-medium px-1.5 py-0 rounded border border-rule-strong bg-surface-elevated text-slate-500 leading-4">
                            {row.original.sector}
                        </span>
                    )}
                </div>
            ),
        },
        {
            accessorKey: 'fund',
            header: 'Fund',
            cell: ({ row }) => (
                <Link href={`/fund/${row.original.fund}`} title={`Open ${row.original.fund} profile`}>
                    <Badge variant="outline" className="font-mono text-[10px] cursor-pointer hover:opacity-80">
                        {row.original.fund}
                    </Badge>
                </Link>
            ),
        },
        {
            id: 'type',
            // Sort by the user-visible bucket (NEW / EXIT / ADD / TRIM).
            // Direction keyed off activeWeightDelta (price-drift removed) so a
            // position that only grew because the stock rallied isn't called an ADD.
            accessorFn: row => {
                const dir = row.activeWeightDelta ?? row.weightDelta;
                return row.type === 'NEW' ? 'NEW'
                    : row.type === 'REMOVED' ? 'EXIT'
                        : dir > 0 ? 'ADD' : 'TRIM';
            },
            header: () => <div className="text-center">Type</div>,
            cell: ({ row }) => {
                const c = row.original;
                const dir = c.activeWeightDelta ?? c.weightDelta;
                return (
                    <div className="text-center">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${c.type === 'NEW' ? 'text-equity border-equity/30'
                            : c.type === 'REMOVED' ? 'text-warning border-warning/30'
                                : dir > 0 ? 'text-buy border-buy/30'
                                    : 'text-sell border-sell/30'
                            }`}>
                            {c.type === 'NEW' ? '★ NEW' : c.type === 'REMOVED' ? '✕ EXIT' : dir > 0 ? 'ADD' : 'TRIM'}
                        </Badge>
                    </div>
                );
            },
        },
        {
            id: 'flow',
            header: () => <div className="text-center" style={{ color: '#e0b03a', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.08em' }}>Flow</div>,
            enableSorting: false,
            cell: ({ row }: { row: { original: Change } }) => {
                if (row.original.isOption) return <div className="flex justify-center"><span className="text-slate-700 text-[10px]">-</span></div>;
                return (
                    <div className="flex justify-center">
                        <FlowChip placement="changes_row" ticker={row.original.ticker} icon />
                    </div>
                );
            },
        },
                {
            id: 'weightDelta',
            // Use active weight delta (price-drift removed) for both the
            // displayed value and sort magnitude.
            accessorFn: row => row.activeWeightDelta ?? row.weightDelta,
            sortingFn: (a, b) =>
                Math.abs(a.original.activeWeightDelta ?? a.original.weightDelta)
                - Math.abs(b.original.activeWeightDelta ?? b.original.weightDelta),
            header: () => <div className="text-right">Δ Weight</div>,
            cell: ({ getValue, row }) => {
                const v = getValue<number>();
                const est = estimateDollars(v, row.original.fund, row.original.isOption);
                return (
                    <div className="text-right">
                        <span className={`flex items-center justify-end gap-0.5 font-mono text-sm font-semibold ${v > 0 ? 'text-buy' : v < 0 ? 'text-sell' : 'text-slate-400'}`}>
                            {v > 0 ? <ArrowUpRight className="h-3 w-3" /> : v < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                            {v > 0 ? '+' : ''}{v.toFixed(3)}%
                        </span>
                        {est && <span className="block font-mono text-[10px] text-slate-500">{est}</span>}
                    </div>
                );
            },
        },
    ], []);

    const table = useReactTable({
        data: preFiltered,
        columns,
        state: { sorting, globalFilter: search },
        onSortingChange: setSorting,
        onGlobalFilterChange: setSearch,
        // Global filter matches against ticker, name, or fund.
        globalFilterFn: (row, _id, value) => {
            const q = String(value).toUpperCase();
            return (
                row.original.ticker.toUpperCase().includes(q)
                || row.original.name.toUpperCase().includes(q)
                || row.original.fund.toUpperCase().includes(q)
            );
        },
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: PAGE_SIZE } },
    });

    // Stats reflect the post-pill view (before TanStack sort/search) so
    // the chip counts match what's actually flowing into the table.
    // Exclude NEW from buys and REMOVED from sells — same logic as the type
    // filter tabs — so "↑ N buys" matches exactly what clicking BUYS shows.
    const buys = preFiltered.filter(c => (c.activeWeightDelta ?? c.weightDelta) > 0 && c.type !== 'NEW').length;
    const sells = preFiltered.filter(c => (c.activeWeightDelta ?? c.weightDelta) < 0 && c.type !== 'REMOVED').length;
    const newPos = preFiltered.filter(c => c.type === 'NEW').length;
    const exits = preFiltered.filter(c => c.type === 'REMOVED').length;

    const fundsForProvider = useMemo(() => {
        const source = selectedProvider
            ? changes.filter(c => (FUND_PROVIDERS[c.fund] ?? c.fund) === selectedProvider)
            : changes;
        return [...new Set(source.map(c => c.fund))].sort();
    }, [changes, selectedProvider]);

    const totalRows = table.getFilteredRowModel().rows.length;
    const pageStart = table.getState().pagination.pageIndex * PAGE_SIZE + 1;
    const pageEnd = Math.min(pageStart + PAGE_SIZE - 1, totalRows);

    return (
        <div className="space-y-4">
            {/* Stats chips */}
            <div className="flex flex-wrap gap-3 text-xs">
                <span className="bg-surface-alt border border-surface-elevated rounded-lg px-3 py-1.5 text-slate-400">
                    {preFiltered.length} changes
                </span>
                <span className="bg-buy/10 border border-buy/20 rounded-lg px-3 py-1.5 text-buy">↑ {buys} buys</span>
                <span className="bg-sell/10 border border-sell/20 rounded-lg px-3 py-1.5 text-sell">↓ {sells} sells</span>
                {newPos > 0 && <span className="bg-equity/10 border border-equity/20 rounded-lg px-3 py-1.5 text-equity">★ {newPos} new</span>}
                {exits > 0 && <span className="bg-warning/10 border border-warning/20 rounded-lg px-3 py-1.5 text-warning">✕ {exits} exits</span>}
            </div>

            {/* Provider filter pills */}
            <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                    <button
                        onClick={() => { setSelectedProvider(null); setSelectedFund(null); setSelectedSector(null); }}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${!selectedProvider
                            ? 'bg-equity/20 border-equity/40 text-equity'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >All Providers</button>
                    {providers.map(p => {
                        const count = changes.filter(c => (FUND_PROVIDERS[c.fund] ?? c.fund) === p).length;
                        if (count === 0) return null;
                        return (
                            <button
                                key={p}
                                onClick={() => { setSelectedProvider(selectedProvider === p ? null : p); setSelectedFund(null); setSelectedSector(null); }}
                                className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${selectedProvider === p
                                    ? 'bg-equity/20 border-equity/40 text-equity'
                                    : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                            >{p} ({count})</button>
                        );
                    })}
                </div>

                {/* Fund sub-filter — only when a provider is selected and has >1 fund */}
                {selectedProvider && fundsForProvider.length > 1 && (
                    <div className="flex flex-wrap gap-1.5 pl-4">
                        <button
                            onClick={() => setSelectedFund(null)}
                            className={`text-[10px] font-mono px-2.5 py-1 rounded-md border transition-colors ${!selectedFund
                                ? 'bg-meta/20 border-meta/40 text-meta'
                                : 'bg-surface-elevated border-rule-strong text-slate-500 hover:text-white'}`}
                        >All Funds</button>
                        {fundsForProvider.map(f => (
                            <button
                                key={f}
                                onClick={() => setSelectedFund(selectedFund === f ? null : f)}
                                className={`text-[10px] font-mono px-2.5 py-1 rounded-md border transition-colors ${selectedFund === f
                                    ? 'bg-meta/20 border-meta/40 text-meta'
                                    : 'bg-surface-elevated border-rule-strong text-slate-500 hover:text-white'}`}
                            >{f}</button>
                        ))}
                    </div>
                )}
            </div>

            {/* Sector filter pills — only shown when there are 2+ distinct sectors in the view */}
            {allSectors.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-500 font-mono shrink-0">sector:</span>
                    <button
                        onClick={() => setSelectedSector(null)}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${!selectedSector
                            ? 'bg-meta/20 border-meta/40 text-meta-bright'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >All</button>
                    {allSectors.map(sec => {
                        const cnt = sectorCounts.get(sec) ?? 0;
                        return (
                            <button
                                key={sec}
                                onClick={() => setSelectedSector(selectedSector === sec ? null : sec)}
                                className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${selectedSector === sec
                                    ? 'bg-meta/20 border-meta/40 text-meta-bright'
                                    : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                            >
                                {sec}{cnt > 0 && <span className="ml-1 opacity-50">({cnt})</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Type filter + view toggle + global text search */}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
                <div className="flex gap-1.5 flex-wrap items-center">
                    {(['all', 'buys', 'sells', 'new', 'exit'] as const).map(t => {
                        const count = typeCounts[t];
                        return (
                            <button
                                key={t}
                                onClick={() => setShowType(t)}
                                className={`text-[10px] font-semibold px-3 py-1.5 rounded-md border transition-colors uppercase tracking-wider ${showType === t
                                    ? 'bg-equity/10 border-equity/30 text-equity'
                                    : 'bg-surface-alt border-surface-elevated text-slate-500 hover:text-white'}`}
                            >
                                {t}
                                {t !== 'all' && count > 0 && (
                                    <span className="ml-1 opacity-50">({count})</span>
                                )}
                            </button>
                        );
                    })}
                    <span className="text-slate-700 text-xs select-none">|</span>
                    <button
                        onClick={() => setGroupByTicker(g => !g)}
                        title="Roll up all fund trades per ticker into one row — see how many funds are buying vs. selling each stock"
                        className={`text-[10px] font-semibold px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5 ${groupByTicker
                            ? 'bg-meta/10 border-meta/30 text-meta'
                            : 'bg-surface-alt border-surface-elevated text-slate-500 hover:text-white'}`}
                    >
                        <Layers className="h-3 w-3" /> by ticker
                    </button>
                </div>
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search ticker, name, or fund…"
                        className="w-full bg-surface-alt border border-surface-elevated rounded-md pl-8 pr-8 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-equity/40"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                            aria-label="Clear search"
                        ><X className="h-3 w-3" /></button>
                    )}
                </div>
            </div>

            {groupByTicker ? (
                /* Ticker-aggregate view — all fund-level equity changes rolled up into
                 * one row per ticker. Shows buying fund count, selling fund count, and
                 * the net AUM-weighted dollar flow. Useful for quickly answering "how
                 * many of my tracked funds are buying NVDA today, and in which direction
                 * does the net institutional money flow?" */
                <div className="rounded-lg border border-rule overflow-hidden">
                    {(() => {
                        const aggColumns: DataTableColumn[] = [
                            { key: 'ticker', header: 'Ticker' },
                            { key: 'name', header: 'Name', mobilePriority: 'md' },
                            { key: 'buying', header: 'Buying', align: 'center' },
                            { key: 'selling', header: 'Selling', align: 'center' },
                            { key: 'netDelta', header: 'Net Δ', align: 'right' },
                        ];
                        const rows: DataTableRow[] = tickerAggs.map((agg) => {
                            const buyCount = agg.fundsBuying.length + agg.fundsNew.length;
                            const buyTip = [...agg.fundsNew.map(f => `★${f}`), ...agg.fundsBuying].join(', ');
                            const sellCount = agg.fundsSelling.length + agg.fundsExited.length;
                            const sellTip = [...agg.fundsExited.map(f => `✕${f}`), ...agg.fundsSelling].join(', ');
                            const dollarStr = fmtNetDollar(agg.netDollarM);
                            return {
                                key: agg.ticker,
                                cells: {
                                    ticker: (
                                        <>
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <Link href={`/stocks/${agg.ticker}`} className="font-mono font-bold text-equity hover:underline">
                                                    {agg.ticker}
                                                </Link>
                                                {agg.fundsNew.length > 0 && (
                                                    <span className="text-[9px] font-bold px-1 rounded border border-equity/30 bg-equity/10 text-equity" title={`New position: ${agg.fundsNew.join(', ')}`}>★NEW</span>
                                                )}
                                                {agg.fundsExited.length > 0 && (
                                                    <span className="text-[9px] font-bold px-1 rounded border border-warning/30 bg-warning/10 text-warning" title={`Fully exited: ${agg.fundsExited.join(', ')}`}>✕EXIT</span>
                                                )}
                                            </div>
                                            {agg.sector && (
                                                <div className="text-[9px] text-slate-600 mt-0.5 font-mono">{agg.sector}</div>
                                            )}
                                        </>
                                    ),
                                    name: <span className="text-slate-400 text-xs truncate block max-w-[200px]">{agg.name}</span>,
                                    buying: buyCount > 0 ? (
                                        <span className="font-mono font-semibold text-sm text-buy" title={buyTip}>↑ {buyCount}</span>
                                    ) : (
                                        <span className="font-mono font-semibold text-sm text-slate-700">—</span>
                                    ),
                                    selling: sellCount > 0 ? (
                                        <span className="font-mono font-semibold text-sm text-sell" title={sellTip}>↓ {sellCount}</span>
                                    ) : (
                                        <span className="font-mono font-semibold text-sm text-slate-700">—</span>
                                    ),
                                    netDelta: (
                                        <>
                                            <span className={`font-mono font-semibold text-sm ${agg.netDelta > 0 ? 'text-buy' : agg.netDelta < 0 ? 'text-sell' : 'text-slate-500'}`}>
                                                {agg.netDelta > 0 ? '+' : ''}{agg.netDelta.toFixed(3)}%
                                            </span>
                                            {dollarStr && <div className="font-mono text-[10px] text-slate-500">{dollarStr}</div>}
                                        </>
                                    ),
                                },
                            };
                        });
                        return (
                            <DataTable
                                columns={aggColumns}
                                rows={rows}
                                emptyMessage={
                                    <>
                                        <p className="text-sm font-medium">No equity changes match your filters</p>
                                        <p className="text-xs mt-1 text-slate-600">Options aren&apos;t included in this view — switch back to see them</p>
                                    </>
                                }
                                wrapperClassName="rounded-none border-0"
                                className="border-0"
                            />
                        );
                    })()}
                    {tickerAggs.length > 0 && (
                        <div className="px-4 py-2 border-t border-rule">
                            <span className="text-[11px] text-slate-600">
                                {tickerAggs.length} unique ticker{tickerAggs.length === 1 ? '' : 's'} · equity only · sorted by total activity
                            </span>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {/* Sortable per-fund table */}
                    <div className="rounded-lg border border-rule overflow-hidden">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-surface-alt">
                                    {table.getHeaderGroups().map(hg => (
                                        <TableRow key={hg.id} className="border-b border-rule hover:bg-transparent">
                                            {hg.headers.map(h => {
                                                const sorted = h.column.getIsSorted();
                                                const canSort = h.column.getCanSort();
                                                return (
                                                    <TableHead
                                                        key={h.id}
                                                        onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                                                        className={`text-slate-400 text-xs uppercase font-semibold tracking-wider ${canSort ? 'cursor-pointer select-none hover:text-white' : ''}`}
                                                    >
                                                        <span className="inline-flex items-center gap-1">
                                                            {flexRender(h.column.columnDef.header, h.getContext())}
                                                            {canSort && (
                                                                sorted === 'asc' ? <ArrowUp className="h-3 w-3" />
                                                                    : sorted === 'desc' ? <ArrowDown className="h-3 w-3" />
                                                                        : <ArrowUpDown className="h-3 w-3 opacity-40" />
                                                            )}
                                                        </span>
                                                    </TableHead>
                                                );
                                            })}
                                        </TableRow>
                                    ))}
                                </TableHeader>
                                <TableBody>
                                    {table.getRowModel().rows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={columns.length} className="text-center py-12 text-slate-500">
                                                <p className="text-sm font-medium">No changes match your filters</p>
                                                <p className="text-xs mt-1 text-slate-600">Try clearing the search or picking a different provider.</p>
                                            </TableCell>
                                        </TableRow>
                                    ) : table.getRowModel().rows.map(row => (
                                        <TableRow key={row.id} className="border-b border-rule hover:bg-surface-hover/50">
                                            {row.getVisibleCells().map(cell => (
                                                <TableCell key={cell.id} className="py-2.5">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Pagination */}
                    {totalRows > PAGE_SIZE && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                            <span className="text-slate-500">
                                Showing {totalRows === 0 ? 0 : pageStart}–{pageEnd} of {totalRows.toLocaleString()}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => table.setPageIndex(0)}
                                    disabled={!table.getCanPreviousPage()}
                                    className="p-1.5 rounded border border-rule bg-surface-alt text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed hover:text-white"
                                    aria-label="First page"
                                ><ChevronsLeft className="h-3.5 w-3.5" /></button>
                                <button
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                    className="p-1.5 rounded border border-rule bg-surface-alt text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed hover:text-white"
                                    aria-label="Previous page"
                                ><ChevronLeft className="h-3.5 w-3.5" /></button>
                                <span className="px-2 text-slate-400 font-mono">
                                    {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
                                </span>
                                <button
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                    className="p-1.5 rounded border border-rule bg-surface-alt text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed hover:text-white"
                                    aria-label="Next page"
                                ><ChevronRight className="h-3.5 w-3.5" /></button>
                                <button
                                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                                    disabled={!table.getCanNextPage()}
                                    className="p-1.5 rounded border border-rule bg-surface-alt text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed hover:text-white"
                                    aria-label="Last page"
                                ><ChevronsRight className="h-3.5 w-3.5" /></button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
