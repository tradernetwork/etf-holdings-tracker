'use client';

// Brokerage-style positions view for option-income funds.
//
// One row per stock, the option legs tucked underneath, and a covered /
// uncovered split — the shape every brokerage positions tab uses. It replaced
// four older sections on the fund page (Top Holdings, the Strategy Map, the
// expiry-grouped Portfolio card and the stock half of Daily Activity), so it
// carries their information too: upside room to the written strike, an
// expiry-ladder grouping, sector, and today's share change.
//
// Stock counts whether it is held outright or synthetically (long call +
// short put at the same strike). KQQQ, GDXY and the YieldMax single-name funds
// hold their underlying that way; counting only real shares would call MSTY
// 0% covered when every one of its written calls sits on synthetic stock.
//
// Sort, filters, search and grouping live in the URL (?sort=coverage&dir=asc
// &cov=none ...) so a view can be linked. Expanding a row uses native
// <details>, so it needs no state.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
    ApiChangeRecord, ApiIncomeFund, ApiOptionActivityDay, ApiPosition, ApiPositionLeg,
} from '@/lib/api';
import { ArrowDown, ArrowUp, ChevronRight, Search, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Formatting ──────────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined): string {
    if (v == null) return '—';
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
    return `${sign}$${a.toFixed(0)}`;
}

function fmtShares(v: number): string {
    return Math.round(v).toLocaleString('en-US');
}

function fmtSigned(v: number): string {
    return `${v > 0 ? '+' : ''}${fmtShares(v)}`;
}

function fmtPrice(v: number | null): string {
    return v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 2026-10-02 → 10/02/26, the way a brokerage prints an option symbol.
function fmtExpiry(e: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e);
    return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : e;
}

function titleCase(s: string): string {
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

const ROLE_LABEL: Record<ApiPositionLeg['role'], string> = {
    'written-call': 'Written call',
    'written-put': 'Written put',
    'long-call': 'Long call',
    'long-put': 'Long put',
    synthetic: 'Synthetic stock',
};

const ROLE_COLOR: Record<ApiPositionLeg['role'], string> = {
    'written-call': 'text-warning',
    'written-put': 'text-equity',
    'long-call': 'text-buy',
    'long-put': 'text-buy',
    synthetic: 'text-slate-500',
};

function coverageColor(pct: number): string {
    if (pct >= 90) return 'var(--buy)';
    if (pct > 0) return 'var(--warning)';
    return 'var(--sell)';
}

// ─── Opened dates ────────────────────────────────────────────────────────────
// When a leg first appeared, taken from the dated activity timeline (last ten
// snapshots). Legs older than the window have no date rather than a wrong one.

function legKey(underlying: string, optionType: string | null, strike: number | null, expiry: string | null): string {
    const t = (optionType ?? '').toUpperCase().startsWith('C') ? 'C' : 'P';
    return `${underlying.toUpperCase()}|${t}|${strike ?? ''}|${expiry ?? ''}`;
}

function openedDates(days: ApiOptionActivityDay[] | undefined): Map<string, string> {
    const m = new Map<string, string>();
    // Oldest day first so a leg reopened later keeps its latest open date.
    for (const d of [...(days ?? [])].reverse()) {
        for (const t of d.trades) {
            for (const l of t.legs) {
                if (!l.prevContracts && l.contracts) m.set(legKey(t.underlying, l.optionType, l.strike, l.expiry), d.date);
            }
        }
    }
    return m;
}

function fmtOpened(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `opened ${Number(m[2])}/${Number(m[3])}` : `opened ${iso}`;
}

// ─── Derived rows ────────────────────────────────────────────────────────────

const UNCLASSIFIED = 'Unclassified';

interface Row {
    p: ApiPosition;
    sector: string;
    /** Today's share change, from the fund's daily diff. Null = unchanged. */
    sharesDelta: number | null;
    isNew: boolean;
    /** Upside room to the nearest-dated live written call. */
    upside: number | null;
    itm: boolean;
    /** Soonest DTE among live written legs (the income book, not synthetics). */
    dte: number | null;
    navPct: number;
}

function deriveRow(p: ApiPosition, change: ApiChangeRecord | undefined): Row {
    const liveWritten = p.legs.filter(l => !l.expired && (l.role === 'written-call' || l.role === 'written-put'));
    const calls = liveWritten.filter(l => l.role === 'written-call');
    const nearestCall = calls.reduce<ApiPositionLeg | null>(
        (best, l) => (best == null || (l.dte ?? Infinity) < (best.dte ?? Infinity) ? l : best), null);
    const dtes = liveWritten.map(l => l.dte).filter((d): d is number => d != null);
    let sharesDelta: number | null = null;
    if (change?.type === 'NEW') sharesDelta = change.currentShares;
    else if (change?.type === 'CHANGED' && change.sharesDelta) sharesDelta = change.sharesDelta;
    return {
        p,
        sector: p.sector ? titleCase(p.sector) : UNCLASSIFIED,
        sharesDelta,
        isNew: change?.type === 'NEW',
        upside: nearestCall?.upsideRoomPct ?? null,
        itm: calls.some(l => l.upsideRoomPct != null && l.upsideRoomPct < 0),
        dte: dtes.length ? Math.min(...dtes) : null,
        navPct: p.exposurePctNav ?? p.weight,
    };
}

// ─── URL state ───────────────────────────────────────────────────────────────

type SortKey = 'symbol' | 'qty' | 'price' | 'value' | 'nav' | 'delta' | 'coverage' | 'upside' | 'dte';
type Coverage = 'all' | 'full' | 'partial' | 'none';
type Toggle = 'synthetic' | 'itm' | 'expiring' | 'changed';

const SORT_LABEL: Record<SortKey, string> = {
    symbol: 'Symbol', qty: 'Qty', price: 'Price', value: 'Mkt value', nav: '% NAV',
    delta: 'Δ today', coverage: 'Covered', upside: 'Upside room', dte: 'DTE',
};

const SORT_VALUE: Record<SortKey, (r: Row) => number | string | null> = {
    symbol: r => r.p.ticker,
    qty: r => r.p.totalShares,
    price: r => r.p.price,
    value: r => r.p.exposureValue,
    nav: r => r.navPct,
    delta: r => r.sharesDelta,
    coverage: r => r.p.coveragePct,
    upside: r => r.upside,
    dte: r => r.dte,
};

// Text-ish columns read naturally A→Z / soonest-first; money columns
// biggest-first. This is the direction a header click starts in.
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
    symbol: 'asc', qty: 'desc', price: 'desc', value: 'desc', nav: 'desc',
    delta: 'desc', coverage: 'asc', upside: 'asc', dte: 'asc',
};

const COVERAGE_LABEL: Record<Coverage, string> = {
    all: 'All', full: 'Covered', partial: 'Partly covered', none: 'Uncovered',
};

const TOGGLE_LABEL: Record<Toggle, string> = {
    synthetic: 'Synthetic', itm: 'Call in the money', expiring: 'Expiring ≤ 7d', changed: 'Changed today',
};

function isSortKey(s: string | null): s is SortKey {
    return !!s && s in SORT_LABEL;
}

function useUrlState() {
    const sp = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const sort: SortKey = isSortKey(sp.get('sort')) ? (sp.get('sort') as SortKey) : 'value';
    const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' ? 'asc' : sp.get('dir') === 'desc' ? 'desc' : DEFAULT_DIR[sort];
    const covRaw = sp.get('cov');
    const cov: Coverage = covRaw === 'full' || covRaw === 'partial' || covRaw === 'none' ? covRaw : 'all';
    const toggles = new Set(
        (sp.get('f') ?? '').split(',').filter((t): t is Toggle => t in TOGGLE_LABEL));
    const sector = sp.get('sector') ?? '';
    const q = sp.get('q') ?? '';
    const group: 'stock' | 'expiry' = sp.get('group') === 'expiry' ? 'expiry' : 'stock';

    const update = useCallback((patch: Record<string, string | null>) => {
        const next = new URLSearchParams(sp.toString());
        for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') next.delete(k);
            else next.set(k, v);
        }
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, [sp, router, pathname]);

    return { sort, dir, cov, toggles, sector, q, group, update };
}

// ─── Layout ──────────────────────────────────────────────────────────────────
// One column template shared by header, stock rows and leg rows. Cells are in
// a fixed DOM order and hidden per breakpoint, so every template must list
// exactly the visible cells:
//   phone  Symbol · Mkt value · Covered
//   md     + Qty, % NAV, Δ today
//   lg     + Price, Upside room, DTE
const COLS = [
    'grid gap-x-3 items-center',
    'grid-cols-[minmax(0,1fr)_auto_auto]',
    'md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_0.7fr_0.9fr_0.9fr]',
    'lg:grid-cols-[minmax(0,1.4fr)_0.9fr_0.8fr_0.9fr_0.6fr_0.8fr_0.9fr_0.8fr_0.5fr]',
].join(' ');

const SHOW: Record<SortKey, string> = {
    symbol: '',
    qty: 'hidden md:block',
    price: 'hidden lg:block',
    value: '',
    nav: 'hidden md:block',
    delta: 'hidden md:block',
    coverage: '',
    upside: 'hidden lg:block',
    dte: 'hidden lg:block',
};

const NUM = 'text-right font-mono tabular-nums';

// ─── Pieces ──────────────────────────────────────────────────────────────────

function CoverageBar({ pct }: { pct: number | null }) {
    if (pct == null) return <span className="text-slate-600">—</span>;
    return (
        <span className="inline-flex items-center gap-1.5 justify-end">
            <span className="font-mono tabular-nums text-xs">{Math.round(pct)}%</span>
            <span className="hidden sm:inline-block w-12 h-1.5 rounded-full bg-slate-800 overflow-hidden" aria-hidden>
                <span className="block h-full" style={{ width: `${Math.min(100, pct)}%`, background: coverageColor(pct) }} />
            </span>
        </span>
    );
}

function Upside({ pct }: { pct: number | null }) {
    if (pct == null) return <span className="text-slate-600">—</span>;
    const cls = pct < 0 ? 'text-sell' : pct < 2 ? 'text-warning' : 'text-buy';
    return <span className={cls}>{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
}

function LegRow({ leg, ticker, opened }: { leg: ApiPositionLeg; ticker?: string; opened?: string }) {
    const symbol = `${ticker ? `${ticker} ` : ''}${fmtExpiry(leg.expiry)} ${leg.strike} ${leg.optionType.toUpperCase().startsWith('C') ? 'C' : 'P'}`;
    return (
        <div className={`${COLS} py-1.5 pl-6 pr-2 text-[11px] ${leg.expired ? 'opacity-50' : ''}`}>
            <div className="min-w-0">
                <span className="font-mono text-slate-300">{symbol}</span>
                <span className={`ml-2 ${ROLE_COLOR[leg.role]}`}>{ROLE_LABEL[leg.role]}</span>
                {/* Upside + DTE move into their own columns at lg; below that they ride here. */}
                <span className="block text-slate-500 lg:hidden">
                    {[
                        leg.expired ? 'expired' : leg.dte != null ? `${Math.round(leg.dte)} DTE` : null,
                        opened ? fmtOpened(opened) : null,
                        leg.upsideRoomPct != null
                            ? leg.upsideRoomPct >= 0 ? `${leg.upsideRoomPct.toFixed(1)}% upside room` : `ITM by ${Math.abs(leg.upsideRoomPct).toFixed(1)}%`
                            : null,
                    ].filter(Boolean).join(' · ')}
                </span>
                {leg.expired && <span className="hidden lg:inline ml-2 text-slate-500">expired</span>}
                {opened && <span className="hidden lg:inline ml-2 text-slate-500">{fmtOpened(opened)}</span>}
            </div>
            <div className={`${SHOW.qty} ${NUM} text-slate-400`}>{fmtSigned(leg.contracts)}</div>
            <div className={`${SHOW.price} ${NUM} text-slate-500`}>{fmtPrice(leg.price)}</div>
            <div className={`${NUM} text-slate-400`}>{fmtMoney(leg.marketValue)}</div>
            <div className={`${SHOW.nav} ${NUM} text-slate-500`}>{leg.weight.toFixed(2)}%</div>
            <div className={SHOW.delta} />
            <div />
            <div className={`${SHOW.upside} ${NUM}`}>
                {leg.role === 'written-call' ? <Upside pct={leg.upsideRoomPct} /> : null}
            </div>
            <div className={`${SHOW.dte} ${NUM} text-slate-500`}>
                {!leg.expired && leg.dte != null ? Math.round(leg.dte) : ''}
            </div>
        </div>
    );
}

function PositionRow({ r, opened }: { r: Row; opened: Map<string, string> }) {
    const { p } = r;
    const synthetic = p.syntheticShares !== 0;
    const qtyNote = synthetic
        ? p.sharesHeld !== 0
            ? `${fmtShares(p.sharesHeld)} held + ${fmtShares(p.syntheticShares)} synthetic`
            : 'all synthetic'
        : p.totalShares < 0 ? 'short' : null;
    const liveLegs = p.legs.filter(l => !l.expired).length;
    return (
        <details className="group border-b border-rule last:border-b-0">
            <summary className={`${COLS} cursor-pointer list-none py-2.5 px-2 hover:bg-white/[0.02] [&::-webkit-details-marker]:hidden`}>
                <div className="min-w-0 flex items-center gap-1.5">
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90 ${p.legs.length ? '' : 'invisible'}`} />
                    <div className="min-w-0">
                        <Link href={`/stocks/${p.ticker}`} className="font-mono font-bold text-sm text-equity hover:underline">
                            {p.ticker}
                        </Link>
                        {synthetic && <span className="ml-1 text-slate-500 text-xs" title="Includes synthetic shares (long call + short put)">*</span>}
                        {r.isNew && <span className="ml-1.5 text-[9px] px-1 rounded bg-equity/15 text-equity align-middle">NEW</span>}
                        <span className="block text-[10px] text-slate-500 truncate">
                            {qtyNote ?? p.name}
                            {liveLegs > 0 && ` · ${liveLegs} leg${liveLegs === 1 ? '' : 's'}`}
                        </span>
                    </div>
                </div>
                <div className={`${SHOW.qty} ${NUM} text-xs text-slate-200`}>{fmtShares(p.totalShares)}</div>
                <div className={`${SHOW.price} ${NUM} text-xs text-slate-400`}>
                    {p.spotSuppressed ? <span title="The fund's mark and the quote feed disagree">n/a</span> : fmtPrice(p.price)}
                </div>
                <div className={`${NUM} text-xs text-slate-200`}>{fmtMoney(p.exposureValue)}</div>
                <div className={`${SHOW.nav} ${NUM} text-xs text-slate-400`}>{r.navPct.toFixed(1)}%</div>
                <div className={`${SHOW.delta} ${NUM} text-xs ${r.sharesDelta == null ? 'text-slate-600' : r.sharesDelta > 0 ? 'text-buy' : 'text-sell'}`}>
                    {r.sharesDelta == null ? '—' : fmtSigned(r.sharesDelta)}
                </div>
                <div className="text-right">
                    <CoverageBar pct={p.coveragePct} />
                    {p.nakedShares > 0 && (
                        <span className="block text-[10px] text-sell">{fmtShares(p.nakedShares)} sh naked</span>
                    )}
                </div>
                <div className={`${SHOW.upside} ${NUM} text-xs`}><Upside pct={r.upside} /></div>
                <div className={`${SHOW.dte} ${NUM} text-xs text-slate-400`}>{r.dte != null ? Math.round(r.dte) : '—'}</div>
            </summary>
            {p.legs.length > 0 && (
                <div className="bg-black/20 border-t border-rule/60">
                    {p.legs.map((l, i) => (
                        <LegRow key={i} leg={l} opened={opened.get(legKey(p.ticker, l.optionType, l.strike, l.expiry))} />
                    ))}
                </div>
            )}
        </details>
    );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors min-h-11 sm:min-h-[28px] ${active
                ? 'border-equity/60 bg-equity/15 text-equity'
                : 'border-rule text-slate-400 hover:text-slate-200 hover:border-slate-500'}`}
        >
            {children}
        </button>
    );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function FundPositions({ income, changes = [] }: {
    income: ApiIncomeFund;
    /** The fund's daily stock changes (option rows excluded) — feeds Δ today. */
    changes?: ApiChangeRecord[];
}) {
    const { sort, dir, cov, toggles, sector, q, group, update } = useUrlState();

    // Search is typed into local state and pushed to the URL shortly after,
    // so each keystroke doesn't trigger a navigation.
    const [query, setQuery] = useState(q);
    useEffect(() => { setQuery(q); }, [q]);
    useEffect(() => {
        if (query === q) return;
        const t = setTimeout(() => update({ q: query || null }), 250);
        return () => clearTimeout(t);
    }, [query, q, update]);

    const positions = income.positions;
    const summary = income.positionsSummary;
    const opened = useMemo(() => openedDates(income.optionActivity), [income.optionActivity]);

    const changeByTicker = useMemo(() => {
        const m = new Map<string, ApiChangeRecord>();
        for (const c of changes) m.set(c.ticker.toUpperCase(), c);
        return m;
    }, [changes]);

    const allRows = useMemo(
        () => (positions ?? []).filter(p => p.totalShares !== 0)
            .map(p => deriveRow(p, changeByTicker.get(p.ticker.toUpperCase()))),
        [positions, changeByTicker]);

    const sectors = useMemo(
        () => [...new Set(allRows.map(r => r.sector))].sort((a, b) =>
            a === UNCLASSIFIED ? 1 : b === UNCLASSIFIED ? -1 : a.localeCompare(b)),
        [allRows]);

    const rows = useMemo(() => {
        const needle = query.trim().toUpperCase();
        const filtered = allRows.filter(r => {
            const c = r.p.coveragePct ?? 0;
            if (cov === 'full' && c < 90) return false;
            if (cov === 'partial' && !(c > 0 && c < 90)) return false;
            if (cov === 'none' && c > 0) return false;
            if (toggles.has('synthetic') && r.p.syntheticShares === 0) return false;
            if (toggles.has('itm') && !r.itm) return false;
            if (toggles.has('expiring') && !(r.dte != null && r.dte <= 7)) return false;
            if (toggles.has('changed') && r.sharesDelta == null) return false;
            if (sector && r.sector !== sector) return false;
            if (needle && !r.p.ticker.toUpperCase().includes(needle) && !r.p.name.toUpperCase().includes(needle)) return false;
            return true;
        });
        const get = SORT_VALUE[sort];
        const sign = dir === 'asc' ? 1 : -1;
        return filtered.sort((a, b) => {
            const va = get(a), vb = get(b);
            // Missing values always sink, whichever way the column is sorted.
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'string' || typeof vb === 'string') return sign * String(va).localeCompare(String(vb));
            return sign * (va - vb);
        });
    }, [allRows, cov, toggles, sector, query, sort, dir]);

    if (!positions || !summary) return null;

    const optionOnly = positions.filter(p => p.totalShares === 0 && p.legs.length > 0);
    const others = income.otherPositions ?? [];
    const anySynthetic = allRows.some(r => r.p.syntheticShares !== 0);
    const isShort = income.archetype === 'short-equity';
    const exited = changes.filter(c => c.type === 'REMOVED');
    const filtersActive = cov !== 'all' || toggles.size > 0 || !!sector || !!q;

    const onSort = (k: SortKey) => {
        if (k === sort) update({ sort: k, dir: dir === 'asc' ? 'desc' : 'asc' });
        else update({ sort: k, dir: null });
    };
    const flip = (t: Toggle) => {
        const next = new Set(toggles);
        if (next.has(t)) next.delete(t); else next.add(t);
        update({ f: [...next].join(',') || null });
    };

    // Stat strip — what the old Portfolio card's tiles carried.
    const legCount = positions.reduce((n, p) => n + p.legs.filter(l => !l.expired).length, 0);
    const bySector = new Map<string, number>();
    for (const r of allRows) if (r.sector !== UNCLASSIFIED) bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + r.p.exposureValue);
    const topSector = [...bySector.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    // Expiry ladder — the old Portfolio card's grouping, now a view toggle.
    const expiryGroups = (() => {
        const m = new Map<string, { ticker: string; leg: ApiPositionLeg }[]>();
        for (const r of rows) for (const leg of r.p.legs) {
            if (leg.expired) continue;
            const list = m.get(leg.expiry) ?? [];
            list.push({ ticker: r.p.ticker, leg });
            m.set(leg.expiry, list);
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    })();

    return (
        <Card className="bg-surface border-rule">
            <CardHeader className="pb-3 border-b border-rule">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-white flex-wrap">
                    <Wallet className="h-5 w-5 text-equity" /> Positions
                    <span className="text-xs font-normal text-slate-500">as of {income.asOfDate}</span>
                </CardTitle>
                {summary.coveredPct != null ? (
                    <div className="pt-3 space-y-2">
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                            <span>
                                <span className="font-mono font-bold text-buy">{summary.coveredPct.toFixed(0)}%</span>
                                <span className="text-slate-400"> covered</span>
                            </span>
                            <span>
                                <span className="font-mono font-bold text-sell">{summary.uncoveredPct?.toFixed(0)}%</span>
                                <span className="text-slate-400"> uncovered</span>
                            </span>
                            {!!summary.syntheticPct && (
                                <span>
                                    <span className="font-mono font-bold text-slate-300">{summary.syntheticPct.toFixed(0)}%</span>
                                    <span className="text-slate-400"> held synthetically</span>
                                </span>
                            )}
                        </div>
                        <div className="flex h-2 rounded-full overflow-hidden bg-slate-800" aria-hidden>
                            <div style={{ width: `${summary.coveredPct}%`, background: 'var(--buy)' }} />
                            <div style={{ width: `${summary.uncoveredPct ?? 0}%`, background: 'var(--sell)', opacity: 0.6 }} />
                        </div>
                        <p className="text-[11px] text-slate-500">
                            Share of the {fmtMoney(summary.stockExposureValue)} {isShort ? 'short ' : ''}stock book
                            with {isShort ? 'a put written against it' : 'a call written against it'}, by value.
                            {' '}Uncovered stock keeps all of its upside and pays no premium.
                        </p>
                    </div>
                ) : (
                    <p className="pt-3 text-xs text-slate-500">
                        {income.incomeLegVisible
                            ? 'No stock position to cover in the latest snapshot.'
                            : 'This fund writes its income options intraday, so they never appear in an end-of-day holdings file — coverage cannot be measured.'}
                    </p>
                )}
                <div className="pt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span><span className="text-slate-300 font-mono">{summary.stockPositions}</span> stocks</span>
                    <span><span className="text-slate-300 font-mono">{legCount}</span> option legs</span>
                    <span><span className="text-slate-300 font-mono">{summary.otherPctNav.toFixed(0)}%</span> in T-bills &amp; cash</span>
                    {topSector && <span>Top sector <span className="text-slate-300">{topSector}</span></span>}
                </div>
            </CardHeader>

            <CardContent className="pt-3 px-2 sm:px-4">
                {allRows.length > 0 && (
                    <div className="space-y-2 px-2 pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="relative flex-1 min-w-[160px] max-w-xs">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="Search symbol or name"
                                    aria-label="Search positions"
                                    className="w-full bg-black/20 border border-rule rounded-md pl-7 pr-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-equity/60"
                                />
                            </label>
                            <select
                                value={sector}
                                onChange={e => update({ sector: e.target.value || null })}
                                aria-label="Filter by sector"
                                className="bg-black/20 border border-rule rounded-md px-2 py-1.5 text-xs text-slate-300 max-w-[180px]"
                            >
                                <option value="">All sectors</option>
                                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            {/* Headers aren't all visible on a phone — this is how you sort there. */}
                            <select
                                value={`${sort}:${dir}`}
                                onChange={e => { const [k, d] = e.target.value.split(':'); update({ sort: k, dir: d }); }}
                                aria-label="Sort by"
                                className="bg-black/20 border border-rule rounded-md px-2 py-1.5 text-xs text-slate-300 lg:hidden"
                            >
                                {(Object.keys(SORT_LABEL) as SortKey[]).flatMap(k => [
                                    <option key={`${k}:desc`} value={`${k}:desc`}>{SORT_LABEL[k]} ↓</option>,
                                    <option key={`${k}:asc`} value={`${k}:asc`}>{SORT_LABEL[k]} ↑</option>,
                                ])}
                            </select>
                            <div className="flex rounded-md border border-rule overflow-hidden text-[11px] ml-auto">
                                {(['stock', 'expiry'] as const).map(g => (
                                    <button
                                        key={g}
                                        type="button"
                                        onClick={() => update({ group: g === 'stock' ? null : g })}
                                        aria-pressed={group === g}
                                        className={`px-2.5 py-1.5 min-h-11 sm:min-h-[28px] ${group === g ? 'bg-equity/15 text-equity' : 'text-slate-400 hover:text-slate-200'}`}
                                    >
                                        By {g}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {(Object.keys(COVERAGE_LABEL) as Coverage[]).map(c => (
                                <Chip key={c} active={cov === c} onClick={() => update({ cov: c === 'all' ? null : c })}>
                                    {COVERAGE_LABEL[c]}
                                </Chip>
                            ))}
                            <span className="hidden sm:block w-px h-4 bg-rule mx-1" aria-hidden />
                            {(Object.keys(TOGGLE_LABEL) as Toggle[])
                                .filter(t => t !== 'synthetic' || anySynthetic)
                                .map(t => (
                                    <Chip key={t} active={toggles.has(t)} onClick={() => flip(t)}>{TOGGLE_LABEL[t]}</Chip>
                                ))}
                            {filtersActive && (
                                <button
                                    type="button"
                                    onClick={() => { setQuery(''); update({ cov: null, f: null, sector: null, q: null }); }}
                                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-200 px-1.5"
                                >
                                    <X className="h-3 w-3" /> Clear
                                </button>
                            )}
                            <span className="text-[11px] text-slate-500 ml-auto">
                                {rows.length === allRows.length ? `${rows.length} positions` : `${rows.length} of ${allRows.length}`}
                            </span>
                        </div>
                    </div>
                )}

                {allRows.length > 0 && group === 'stock' && (
                    <>
                        <div className={`${COLS} px-2 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-rule`}>
                            {(Object.keys(SORT_LABEL) as SortKey[]).map(k => (
                                <div
                                    key={k}
                                    role="columnheader"
                                    aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    className={`${SHOW[k]} ${k === 'symbol' ? 'text-left pl-5' : 'text-right'}`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onSort(k)}
                                        className={`uppercase tracking-wider hover:text-slate-200 ${sort === k ? 'text-slate-200' : ''}`}
                                    >
                                        <span className="inline-flex items-center gap-0.5">
                                            {SORT_LABEL[k]}
                                            {sort === k && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                                        </span>
                                    </button>
                                </div>
                            ))}
                        </div>
                        {rows.length === 0 ? (
                            <p className="px-2 py-6 text-center text-xs text-slate-500">No positions match these filters.</p>
                        ) : rows.map(r => <PositionRow key={r.p.ticker} r={r} opened={opened} />)}
                    </>
                )}

                {allRows.length > 0 && group === 'expiry' && (
                    expiryGroups.length === 0 ? (
                        <p className="px-2 py-6 text-center text-xs text-slate-500">No live option legs on the filtered positions.</p>
                    ) : expiryGroups.map(([exp, legs]) => {
                        const dte = legs[0]?.leg.dte;
                        return (
                            <div key={exp} className="border-b border-rule last:border-b-0">
                                <div className="px-2 pt-3 pb-1 flex items-baseline gap-2">
                                    <span className="font-mono text-sm font-bold text-slate-200">{fmtExpiry(exp)}</span>
                                    {dte != null && <span className="text-[11px] text-slate-500">{Math.round(dte)} DTE</span>}
                                    <span className="text-[11px] text-slate-600 ml-auto">{legs.length} leg{legs.length === 1 ? '' : 's'}</span>
                                </div>
                                {legs.map(({ ticker, leg }, i) => (
                                    <LegRow key={`${ticker}-${i}`} leg={leg} ticker={ticker}
                                        opened={opened.get(legKey(ticker, leg.optionType, leg.strike, leg.expiry))} />
                                ))}
                            </div>
                        );
                    })
                )}

                {optionOnly.length > 0 && (
                    <>
                        <div className="px-2 pt-4 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
                            Options without a stock position
                        </div>
                        {optionOnly.map(p => (
                            <div key={p.ticker} className="border-b border-rule last:border-b-0">
                                <div className="px-2 pt-2 font-mono font-bold text-sm text-slate-300">{p.ticker}</div>
                                {p.legs.map((l, i) => (
                                    <LegRow key={i} leg={l} opened={opened.get(legKey(p.ticker, l.optionType, l.strike, l.expiry))} />
                                ))}
                            </div>
                        ))}
                    </>
                )}

                {exited.length > 0 && (
                    <div className="px-2 pt-4 text-[11px] text-slate-500">
                        <span className="uppercase tracking-wider text-[10px]">Exited today</span>{' '}
                        {exited.map((c, i) => (
                            <span key={c.ticker}>
                                {i > 0 && ', '}
                                <Link href={`/stocks/${c.ticker}`} className="font-mono text-slate-300 hover:underline">{c.ticker}</Link>
                                <span className="text-slate-600"> ({fmtShares(c.previousShares)} sh)</span>
                            </span>
                        ))}
                    </div>
                )}

                {others.length > 0 && (
                    <div className="mt-3 border-t border-rule">
                        {others.map(o => (
                            <div key={o.sleeve} className={`${COLS} px-2 py-2 text-xs text-slate-400`}>
                                <div className="pl-5">
                                    {o.label}
                                    <span className="block text-[10px] text-slate-600">{o.lines} line{o.lines === 1 ? '' : 's'}</span>
                                </div>
                                <div className={SHOW.qty} />
                                <div className={SHOW.price} />
                                <div className={NUM}>{fmtMoney(o.marketValue)}</div>
                                <div className={`${SHOW.nav} ${NUM}`}>{o.weight.toFixed(1)}%</div>
                                <div className={SHOW.delta} />
                                <div />
                                <div className={SHOW.upside} />
                                <div className={SHOW.dte} />
                            </div>
                        ))}
                    </div>
                )}

                {anySynthetic && (
                    <p className="px-2 pt-3 text-[10px] text-slate-500">
                        * Includes synthetic shares — a long call and short put at the same strike and expiry,
                        which behaves like owning 100 shares per contract. Market value shows the stock
                        exposure, not the option premium.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
