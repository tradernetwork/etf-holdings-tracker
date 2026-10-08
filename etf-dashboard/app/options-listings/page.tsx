"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { CboeScanResult } from "@/lib/api";
import {
    ChevronDown, ChevronUp, Activity, Landmark, TrendingUp,
    Flame, Trash2, Radio, ArrowLeft,
} from "lucide-react";
import { getMWFExpirationStatus, MWF_TICKERS } from "@/lib/marketHours";
import { SiteNav } from "@/components/site-nav";

// ─── Filtering ───────────────────────────────────────────────────────────────

type CatFilter = "all" | "optionable" | "etfs" | "equities";

const CAT_OPTIONS: [CatFilter, string][] = [
    ["all", "All"],
    ["optionable", "Newly Optionable"],
    ["etfs", "Weekly ETFs"],
    ["equities", "Weekly Equities"],
];

/**
 * Apply the category + ticker filter to one scan, returning the six entry
 * lists already narrowed. A category other than "all" zeroes the other
 * categories; the search matches the ticker symbol or the company name.
 */
function filterScanEntries(scan: CboeScanResult, category: CatFilter, search: string) {
    const q = search.trim().toUpperCase();
    const match = (e: [string, string]) =>
        !q || e[0].toUpperCase().includes(q) || e[1].toUpperCase().includes(q);
    const on = (c: CatFilter) => category === "all" || category === c;
    const pick = (obj: Record<string, string>, c: CatFilter) =>
        on(c) ? Object.entries(obj).filter(match) : [];
    return {
        newOptionable: pick(scan.diff.optionable.new, "optionable"),
        removedOptionable: pick(scan.diff.optionable.removed, "optionable"),
        newWeeklyEtfs: pick(scan.diff.weeklyEtfs.new, "etfs"),
        removedWeeklyEtfs: pick(scan.diff.weeklyEtfs.removed, "etfs"),
        newWeeklyEquities: pick(scan.diff.weeklyEquities.new, "equities"),
        removedWeeklyEquities: pick(scan.diff.weeklyEquities.removed, "equities"),
    };
}

// ─── Ticker Badge ────────────────────────────────────────────────────────────

function TickerBadge({ ticker, name, type }: { ticker: string; name: string; type: "new" | "removed" }) {
    return (
        <Link
            href={`/stocks/${ticker}`}
            className={`group flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 hover:scale-[1.02] ${
                type === "new"
                    ? "bg-buy/5 border-buy/20 hover:border-buy/50 hover:bg-buy/10"
                    : "bg-sell/5 border-sell/20 hover:border-sell/50 hover:bg-sell/10"
            }`}
        >
            <div className={`flex-shrink-0 w-2 h-2 rounded-full ${
                type === "new" ? "bg-buy" : "bg-sell"
            }`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className={`font-mono font-bold text-sm tracking-wide ${type === "new" ? "text-buy" : "text-sell"}`}>
                        {ticker}
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        type === "new"
                            ? "bg-buy/15 text-buy"
                            : "bg-sell/15 text-sell"
                    }`}>
                        {type === "new" ? "NEW" : "REMOVED"}
                    </span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5 group-hover:text-slate-300 transition-colors">
                    {name}
                </p>
            </div>
            <span className="text-slate-600 group-hover:text-slate-400 transition-colors text-sm">→</span>
        </Link>
    );
}

// ─── Expandable Category Section ─────────────────────────────────────────────

function CategorySection({ label, entries, type }: {
    label: string;
    entries: [string, string][];
    type: "new" | "removed";
}) {
    if (entries.length === 0) return null;
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2 px-1">
                <Trash2 className="w-3.5 h-3.5 text-sell/60" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-sell/15 text-sell/70 border border-sell/20">
                    −{entries.length}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-2">
                {entries.map(([ticker, name]) => (
                    <TickerBadge key={`${type}-${ticker}`} ticker={ticker} name={name} type={type} />
                ))}
            </div>
        </div>
    );
}

// ─── MWF Elite 0DTE Box ──────────────────────────────────────────────────────

function MWFEliteBox() {
    const mwf = getMWFExpirationStatus();
    return (
        <div
            className="relative rounded-xl border overflow-hidden bg-surface"
            style={{ borderColor: mwf.isExpirationDay ? "color-mix(in srgb, var(--warning) 35%, transparent)" : "var(--rule)" }}
        >
            <div className="px-5 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                        mwf.isExpirationDay
                            ? "bg-warning/15 border border-warning/30"
                            : "bg-rule border border-rule"
                    }`}>
                        <Flame className={`w-4 h-4 ${mwf.isExpirationDay ? "text-warning" : "text-slate-500"}`} />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-white tracking-tight">MWF Elite Expirations</h2>
                        <p className="text-[11px] text-slate-500">
                            Mon / Wed / Fri weekly options · Excludes SPY &amp; QQQ
                        </p>
                    </div>
                </div>
                {mwf.isExpirationDay ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase bg-warning/15 text-warning border border-warning/30">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-warning" />
                        </span>
                        0DTE Today
                    </span>
                ) : (
                    <span className="text-[11px] font-semibold text-slate-500 px-3 py-1 rounded-full bg-surface-alt border border-rule">
                        Next: {mwf.nextExpirationDay}
                    </span>
                )}
            </div>
            <div className="px-5 pb-4">
                <div className="flex flex-wrap gap-2">
                    {MWF_TICKERS.map((ticker) => (
                        <Link
                            key={ticker}
                            href={`/stocks/${ticker}`}
                            className={`group px-3.5 py-2 rounded-lg text-xs font-mono font-bold tracking-wide border transition-all duration-150 hover:scale-[1.04] ${
                                mwf.isExpirationDay
                                    ? "bg-warning/8 border-warning/20 text-warning"
                                    : "bg-surface-alt border-rule text-slate-400"
                            }`}
                        >
                            {ticker}
                            <span className="ml-1.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity text-slate-500">→</span>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Timeline Entry ──────────────────────────────────────────────────────────

function TimelineEntry({ scan, category, search }: {
    scan: CboeScanResult;
    category: CatFilter;
    search: string;
}) {
    const [removedOpen, setRemovedOpen] = useState(false);
    const date = new Date(scan.date);
    const dateLabel = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeLabel = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    const {
        newOptionable, removedOptionable, newWeeklyEtfs,
        removedWeeklyEtfs, newWeeklyEquities, removedWeeklyEquities,
    } = filterScanEntries(scan, category, search);
    const filterActive = category !== "all" || search.trim() !== "";

    const totalNew = newOptionable.length + newWeeklyEtfs.length + newWeeklyEquities.length;
    const totalRemoved = removedOptionable.length + removedWeeklyEtfs.length + removedWeeklyEquities.length;

    if (!scan.hasChanges) {
        return (
            <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-rule bg-surface/40">
                <div className="flex-1">
                    <span className="text-sm font-semibold text-slate-400">{dateLabel}</span>
                    <span className="text-xs text-slate-600 ml-2">{timeLabel}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                    <span className="text-xs">✓</span>
                    <span className="text-xs">stable — no changes</span>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-rule bg-surface overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
                <div>
                    <span className="text-sm font-bold text-white">{dateLabel}</span>
                    <span className="text-xs text-slate-500 ml-2">{timeLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                    {totalNew > 0 && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-buy/15 text-buy border border-buy/30">
                            +{totalNew} new
                        </span>
                    )}
                    {totalRemoved > 0 && (
                        <button
                            onClick={() => setRemovedOpen(!removedOpen)}
                            className="text-xs font-bold px-2 py-0.5 rounded-full bg-sell/10 text-sell/70 border border-sell/20 hover:bg-sell/20 transition-colors flex items-center gap-1"
                        >
                            −{totalRemoved} removed
                            {removedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                    )}
                </div>
            </div>
            <div className="p-3 space-y-4">
                {totalNew > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {newOptionable.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 px-1">
                                    <Flame className="w-3.5 h-3.5 text-warning" />
                                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Newly Optionable</span>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                    {newOptionable.map(([ticker, name]) => (
                                        <TickerBadge key={`new-${ticker}`} ticker={ticker} name={name} type="new" />
                                    ))}
                                </div>
                            </div>
                        )}
                        {newWeeklyEtfs.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 px-1">
                                    <Landmark className="w-3.5 h-3.5 text-meta" />
                                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Weekly ETFs</span>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                    {newWeeklyEtfs.map(([ticker, name]) => (
                                        <TickerBadge key={`new-etf-${ticker}`} ticker={ticker} name={name} type="new" />
                                    ))}
                                </div>
                            </div>
                        )}
                        {newWeeklyEquities.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 px-1">
                                    <TrendingUp className="w-3.5 h-3.5 text-equity" />
                                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Weekly Equities</span>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                    {newWeeklyEquities.map(([ticker, name]) => (
                                        <TickerBadge key={`new-eq-${ticker}`} ticker={ticker} name={name} type="new" />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {totalRemoved > 0 && (removedOpen || filterActive) && (
                    <div className="pt-3 border-t border-rule grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <CategorySection label="Options Removed" entries={removedOptionable} type="removed" />
                        <CategorySection label="Weekly ETFs Removed" entries={removedWeeklyEtfs} type="removed" />
                        <CategorySection label="Weekly Equities Removed" entries={removedWeeklyEquities} type="removed" />
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Totals Card ─────────────────────────────────────────────────────────────

function TotalCard({ icon, value, label, blurb }: {
    icon: React.ReactNode; value: number; label: string; blurb: string;
}) {
    return (
        <div className="bg-surface border border-rule rounded-xl p-4 sm:p-5 flex sm:flex-col items-center sm:items-start gap-4 sm:gap-0">
            <div className="shrink-0 sm:mb-2 p-2 rounded-lg bg-surface-alt border border-rule">
                {icon}
            </div>
            <div className="flex-1 sm:flex-none">
                <div className="text-2xl sm:text-3xl font-black font-mono text-white">{value.toLocaleString()}</div>
                <div className="text-sm font-semibold text-slate-300 mt-0.5">{label}</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">{blurb}</div>
            </div>
        </div>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OptionsListingsPage() {
    const [latest, setLatest] = useState<CboeScanResult | null>(null);
    const [history, setHistory] = useState<CboeScanResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [category, setCategory] = useState<CatFilter>("all");
    const [search, setSearch] = useState("");

    const filterActive = category !== "all" || search.trim() !== "";
    const visibleScans = filterActive
        ? history.filter((s) =>
            Object.values(filterScanEntries(s, category, search)).some((a) => a.length > 0))
        : history;

    useEffect(() => {
        api.optionsListings()
            .then((data) => {
                if (!data) {
                    setError("Failed to fetch CBOE scan data");
                    return;
                }
                setLatest(data.latest ?? null);
                setHistory(data.history ?? []);
            })
            .catch(() => setError("Failed to fetch CBOE scan data"))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 font-sans">
            <div className="max-w-7xl mx-auto space-y-6">

                <SiteNav />

                {/* Header */}
                <div className="bg-surface border border-rule p-4 rounded-xl shadow-lg">
                    <Link href="/dashboard" className="text-xs text-slate-500 hover:text-white transition-colors flex items-center gap-1 mb-2">
                        <ArrowLeft className="h-3 w-3" /> Back to Dashboard
                    </Link>
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                        CBOE Options Scanner
                    </h1>
                    <p className="text-sm text-slate-400 mt-1 max-w-3xl">
                        A daily diff of CBOE&apos;s published option universe — stocks gaining options
                        for the first time, and weekly-options promotions or demotions. Refreshed
                        each weekday morning. Standalone CBOE market data, the same for everyone.
                    </p>
                </div>

                {/* Error */}
                {error && (
                    <div className="bg-sell/10 border border-sell/30 rounded-xl p-4 text-center">
                        <p className="text-sell font-semibold text-sm">{error}</p>
                    </div>
                )}

                {/* Totals */}
                {latest && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                        <TotalCard
                            icon={<Activity className="w-5 h-5 text-equity" />}
                            value={latest.totals.allOptionable}
                            label="All Optionable Stocks"
                            blurb="The full universe of US-listed equities with at least one options contract on CBOE — not a filtered list."
                        />
                        <TotalCard
                            icon={<Landmark className="w-5 h-5 text-meta" />}
                            value={latest.totals.weeklyEtfs}
                            label="Weekly ETFs"
                            blurb="ETFs approved for weekly options expirations — more liquidity and tighter spreads than monthly-only products."
                        />
                        <TotalCard
                            icon={<TrendingUp className="w-5 h-5 text-buy" />}
                            value={latest.totals.weeklyEquities}
                            label="Weekly Equities"
                            blurb="Individual stocks approved for weekly options expirations, promoted once they have enough volume and open interest."
                        />
                    </div>
                )}

                {/* MWF box */}
                {!loading && <MWFEliteBox />}

                {/* Loading */}
                {loading && (
                    <div className="space-y-6 animate-pulse">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="bg-surface border border-rule rounded-xl p-5">
                                    <div className="w-10 h-10 rounded-lg bg-rule mb-3" />
                                    <div className="h-8 w-24 rounded bg-rule mb-2" />
                                    <div className="h-4 w-32 rounded bg-rule mb-2" />
                                    <div className="h-3 w-full rounded bg-rule" />
                                </div>
                            ))}
                        </div>
                        <div className="space-y-3">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="bg-surface border border-rule rounded-xl p-4">
                                    <div className="flex justify-between mb-3">
                                        <div className="h-4 w-32 rounded bg-rule" />
                                        <div className="h-4 w-20 rounded bg-rule" />
                                    </div>
                                    <div className="h-12 rounded bg-rule" />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* No data */}
                {!loading && !error && history.length === 0 && (
                    <div className="bg-surface border border-rule rounded-xl p-12 text-center">
                        <div className="flex justify-center mb-3">
                            <Radio className="w-12 h-12 text-equity" />
                        </div>
                        <h2 className="text-lg font-bold text-white mb-1">No Scan History Yet</h2>
                        <p className="text-slate-400 text-sm max-w-sm mx-auto">
                            The scanner runs automatically each weekday morning. Check back after
                            the next scheduled run.
                        </p>
                    </div>
                )}

                {/* Timeline + filters */}
                {!loading && history.length > 0 && (
                    <div className="space-y-3">
                        {/* Filter bar — narrow a busy scanner to one category or ticker */}
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                            <div className="inline-flex flex-wrap rounded-lg border border-rule bg-surface-alt p-0.5 text-xs">
                                {CAT_OPTIONS.map(([k, label]) => (
                                    <button
                                        key={k}
                                        onClick={() => setCategory(k)}
                                        className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                                            category === k
                                                ? "bg-equity text-canvas"
                                                : "text-slate-400 hover:text-white"
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Filter by ticker or name…"
                                aria-label="Filter by ticker or name"
                                className="flex-1 sm:max-w-xs bg-surface-alt border border-rule rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-equity transition-colors"
                            />
                        </div>

                        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                            {filterActive
                                ? `${visibleScans.length} matching scan${visibleScans.length !== 1 ? "s" : ""}`
                                : `Last ${history.length} scan${history.length !== 1 ? "s" : ""}`}
                        </h2>

                        {visibleScans.length === 0 ? (
                            <div className="bg-surface border border-rule rounded-xl p-8 text-center">
                                <p className="text-slate-400 text-sm">No scans match that filter.</p>
                                <p className="text-xs text-slate-600 mt-1">
                                    Try a different category or clear the search.
                                </p>
                            </div>
                        ) : (
                            visibleScans.map((scan) => (
                                <TimelineEntry key={scan.date} scan={scan} category={category} search={search} />
                            ))
                        )}
                    </div>
                )}

                {/* How it works */}
                {!loading && (
                    <div className="bg-surface border border-rule rounded-xl p-5 text-sm text-slate-400 space-y-3">
                        <p className="text-slate-300 font-semibold text-xs uppercase tracking-wider">How it works</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="flex items-start gap-2">
                                <Flame className="w-5 h-5 text-warning mt-0.5 shrink-0" />
                                <div>
                                    <span className="text-slate-300 font-semibold block">Newly Optionable</span>
                                    Stocks that just got options listed for the first time.
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <Landmark className="w-5 h-5 text-meta mt-0.5 shrink-0" />
                                <div>
                                    <span className="text-slate-300 font-semibold block">Weekly ETFs</span>
                                    ETFs gaining or losing weekly options expirations.
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <TrendingUp className="w-5 h-5 text-equity mt-0.5 shrink-0" />
                                <div>
                                    <span className="text-slate-300 font-semibold block">Weekly Equities</span>
                                    Stocks promoted to (or removed from) weekly options.
                                </div>
                            </div>
                        </div>
                        <p className="text-xs text-slate-600 pt-1 border-t border-rule">
                            Data sourced from CBOE&apos;s Symbol Directory and Available Weeklys CSVs.
                            Click any ticker to open its cross-fund view.
                        </p>
                    </div>
                )}

            </div>
        </div>
    );
}
