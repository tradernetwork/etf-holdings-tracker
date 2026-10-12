'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Star, BellRing, X, CircleCheck } from 'lucide-react';
import { useWatchlist, type WatchItem } from '@/lib/watchlist';
import { TMLink } from '@/components/tm-link';
import { API_BASE } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardData {
    name: string;
    /** Short summary for the "Funds today" tile */
    fundsLabel: string;
    fundsSubLabel: string;
    fundsPositive: boolean | null; // null = neutral (fund)
    /** "Check live" or a matched flow tag */
    flowLabel: string;
}

// ─── API helpers (client-side, no Next.js cache) ──────────────────────────────

async function fetchTickerCard(symbol: string): Promise<CardData | null> {
    try {
        const res = await fetch(`${API_BASE}/api/v1/ticker/${encodeURIComponent(symbol)}`, {
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const data = await res.json();
        const changes: { activeWeightDelta?: number; weightDelta: number }[] =
            data.changes ?? [];
        const net = changes.reduce(
            (sum: number, c) => sum + (c.activeWeightDelta ?? c.weightDelta ?? 0),
            0,
        );
        const fundCount: number = data.fundCount ?? changes.length;
        const sign = net > 0 ? '+' : '';
        return {
            name: data.name ?? symbol,
            fundsLabel: `${sign}${net.toFixed(3)}%`,
            fundsSubLabel: `${fundCount} fund${fundCount !== 1 ? 's' : ''} active`,
            fundsPositive: net > 0 ? true : net < 0 ? false : null,
            flowLabel: 'Check live',
        };
    } catch {
        return null;
    }
}

async function fetchFundCard(symbol: string): Promise<CardData | null> {
    try {
        const res = await fetch(`${API_BASE}/api/v1/fund/${encodeURIComponent(symbol)}`, {
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const data = await res.json();
        const changes: { activeWeightDelta?: number; weightDelta: number }[] =
            data.recentChanges ?? [];
        const buying = changes.filter(
            (c) => (c.activeWeightDelta ?? c.weightDelta ?? 0) > 0,
        ).length;
        const selling = changes.filter(
            (c) => (c.activeWeightDelta ?? c.weightDelta ?? 0) < 0,
        ).length;
        return {
            name: data.fund ?? symbol,
            fundsLabel: `${buying}↑ ${selling}↓`,
            fundsSubLabel: 'positions today',
            fundsPositive: null,
            flowLabel: 'Check live',
        };
    } catch {
        return null;
    }
}

// ─── Route helpers ────────────────────────────────────────────────────────────

function hrefFor(item: WatchItem): string {
    return item.type === 'stock' ? `/stocks/${item.symbol}` : `/fund/${item.symbol}`;
}

function tickerColor(type: WatchItem['type']): string {
    return type === 'stock' ? 'text-equity' : 'text-meta-bright';
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
    return (
        <div className="flex flex-col items-center gap-4 py-20 text-center px-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface border border-rule">
                <Star className="h-6 w-6 text-slate-600" />
            </span>
            <div>
                <p className="font-bold text-white">Nothing here yet</p>
                <p className="mt-1 text-sm text-subtext max-w-[28ch] mx-auto">
                    Star any ticker or fund across TickerTrace to add it here.
                </p>
            </div>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
                <Link
                    href="/stocks"
                    className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl border border-rule bg-surface text-sm font-semibold text-equity hover:bg-surface-hover transition-colors"
                >
                    Browse stocks
                </Link>
                <Link
                    href="/funds"
                    className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl border border-rule bg-surface text-sm font-semibold text-meta-bright hover:bg-surface-hover transition-colors"
                >
                    Browse funds
                </Link>
            </div>
        </div>
    );
}

// ─── Alert modal ─────────────────────────────────────────────────────────────

const PERKS = [
    'Push + email the moment flow hits your list',
    'TraderLady explains each print in plain English',
    'Cancel anytime during the trial',
];

function AlertModal({ items, onClose }: { items: WatchItem[]; onClose: () => void }) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const preview = items.slice(0, 4).map((i) => i.symbol);
    const previewStr =
        preview.length > 1
            ? preview.slice(0, -1).join(', ') + ' & ' + preview[preview.length - 1]
            : preview[0] ?? 'your tickers';

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div
            ref={overlayRef}
            onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-label="Set up flow alerts"
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-[rgba(5,7,13,0.72)] p-3 sm:p-6"
            style={{ backdropFilter: 'blur(4px)' }}
        >
            <div
                className="w-full max-w-[440px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[18px] border border-tm-gold/40 bg-surface p-5 sm:p-6 flex flex-col gap-4"
                style={{ boxShadow: '0 30px 60px rgba(0,0,0,.5)' }}
            >
                {/* Header row */}
                <div className="flex justify-between items-start">
                    <Image
                        src="/brand/tm-lockup.png"
                        alt="TraderMatrix"
                        width={130}
                        height={26}
                        style={{ height: 26, width: 'auto' }}
                        priority
                    />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-subtext hover:text-white transition-colors -mr-2.5 -mt-2.5"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Copy */}
                <div>
                    <h2 className="text-xl font-black tracking-tight text-white leading-snug">
                        Real-time alerts for {previewStr}
                    </h2>
                    <p className="mt-1.5 text-sm text-subtext leading-relaxed">
                        TickerTrace updates once a day. TraderMatrix pings you the minute a
                        sweep, block or golden sweep hits a ticker on your list.
                    </p>
                </div>

                {/* Perks */}
                <ul className="flex flex-col gap-2">
                    {PERKS.map((perk) => (
                        <li key={perk} className="flex items-center gap-2.5 text-sm text-slate-200">
                            <CircleCheck className="h-3.5 w-3.5 shrink-0 text-tm-gold" />
                            {perk}
                        </li>
                    ))}
                </ul>

                {/* CTA — the URL is the standard ref link, NOT the watchlist */}
                <TMLink
                    placement="watchlist_alert_modal"
                    className="block text-center py-3 px-4 rounded-xl bg-tm-gold text-canvas text-sm font-extrabold hover:bg-tm-gold-bright transition-colors"
                    style={{ minHeight: 44 }}
                >
                    Start free trial · import my watchlist →
                </TMLink>

                {/* Disclosure */}
                <p className="text-center text-[10px] text-slate-500 leading-relaxed">
                    Your watchlist is passed to TraderMatrix only if you click. Referral link disclosed.
                </p>
            </div>
        </div>
    );
}

// ─── Single watchlist card ────────────────────────────────────────────────────

function WatchCard({ item }: { item: WatchItem }) {
    const [cardData, setCardData] = useState<CardData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const fetcher = item.type === 'stock' ? fetchTickerCard : fetchFundCard;
        fetcher(item.symbol).then((d) => {
            if (!cancelled) {
                setCardData(d);
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [item.type, item.symbol]);

    const fundsPositive = cardData?.fundsPositive;
    const fundsColor =
        fundsPositive === true ? 'text-buy' : fundsPositive === false ? 'text-sell' : 'text-white';

    return (
        <div className="bg-surface border border-rule rounded-[14px] p-4 flex flex-col gap-3">
            {/* Header row */}
            <div className="flex justify-between items-start gap-2">
                <div>
                    <Link
                        href={hrefFor(item)}
                        className={`font-mono font-black text-xl leading-none hover:underline ${tickerColor(item.type)}`}
                    >
                        {item.symbol}
                    </Link>
                    {loading ? (
                        <div className="mt-1 h-3 w-24 rounded bg-surface-elevated animate-pulse" />
                    ) : (
                        <div className="mt-1 text-xs text-slate-500 truncate max-w-[180px]">
                            {cardData?.name ?? item.symbol}
                        </div>
                    )}
                </div>
                <Star className="h-4 w-4 shrink-0 fill-tm-gold text-tm-gold mt-0.5" />
            </div>

            {/* Data tiles */}
            <div className="grid grid-cols-2 gap-2">
                {/* Funds today tile */}
                <div className="bg-surface-alt border border-rule rounded-lg px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                        Funds today
                    </div>
                    {loading ? (
                        <div className="mt-1 h-4 w-16 rounded bg-surface-elevated animate-pulse" />
                    ) : (
                        <>
                            <div className={`font-mono font-bold text-sm leading-snug mt-0.5 ${fundsColor}`}>
                                {cardData?.fundsLabel ?? '—'}
                            </div>
                            <div className="text-[10px] text-slate-500">
                                {cardData?.fundsSubLabel ?? ''}
                            </div>
                        </>
                    )}
                </div>

                {/* Options flow tile */}
                <div className="bg-[rgba(224,176,58,0.05)] border border-tm-gold/25 rounded-lg px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-tm-gold-bright font-semibold">
                        Options flow
                    </div>
                    <div className="font-bold text-[13px] text-white leading-snug mt-0.5">
                        {cardData?.flowLabel ?? 'Check live'}
                    </div>
                    <div className="text-[10px] text-slate-500">via TraderMatrix</div>
                </div>
            </div>

            {/* TraderMatrix CTA */}
            <TMLink
                placement="watchlist_card"
                ticker={item.symbol}
                className="inline-flex min-h-11 items-center text-xs font-bold text-tm-gold-bright hover:text-white transition-colors"
            >
                Open {item.symbol} on TraderMatrix →
            </TMLink>
        </div>
    );
}

// ─── Main exported component ──────────────────────────────────────────────────

export function WatchlistClient() {
    const { items } = useWatchlist();
    const [modalOpen, setModalOpen] = useState(false);

    const today = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });

    return (
        <div className="min-h-dvh bg-canvas text-white">
            <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col gap-6">
                {/* Header card */}
                <div className="bg-surface border border-rule rounded-[14px] p-4 flex flex-wrap justify-between items-center gap-4">
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight leading-none">
                            <Star className="h-6 w-6 fill-tm-gold text-tm-gold shrink-0" aria-hidden />
                            Your watchlist
                        </h1>
                        <p className="mt-1 text-sm text-subtext">
                            {today} · {items.length} ticker{items.length !== 1 ? 's' : ''} · saved in this browser, no login
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className="inline-flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-xl bg-tm-gold text-canvas text-[13px] font-extrabold hover:bg-tm-gold-bright transition-colors"
                    >
                        <BellRing className="h-4 w-4" />
                        Alert me when flow hits
                    </button>
                </div>

                {/* Cards grid or empty state */}
                {items.length === 0 ? (
                    <EmptyState />
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {items.map((item) => (
                            <WatchCard key={`${item.type}:${item.symbol}`} item={item} />
                        ))}
                    </div>
                )}

                {/* Footer hint */}
                {items.length > 0 && (
                    <p className="text-center text-xs text-slate-500">
                        Star any ticker or fund across TickerTrace to add it here.
                    </p>
                )}
            </div>

            {/* Alert modal */}
            {modalOpen && <AlertModal items={items} onClose={() => setModalOpen(false)} />}
        </div>
    );
}
