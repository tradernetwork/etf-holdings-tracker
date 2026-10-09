'use client';

/**
 * Public visitor counter pill.
 *
 * Renders on every page (mounted in app/layout.tsx). Fires a one-shot
 * /api/v1/visits/track on mount (the page hit) and polls /visits/live
 * every 30 seconds for the displayed counts.
 *
 * No PII collected — the API hashes IP + a server-side salt before storing.
 * See api/visits.py.
 */

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.tickertrace.pro';
const POLL_INTERVAL_MS = 30_000;

interface LiveCounts {
    now: number;
    today: number;
    week: number;
    allTime: number;
    asOf: number;
}

function compact(n: number): string {
    if (n < 1000) return n.toString();
    if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (n < 1_000_000) return Math.round(n / 1000) + 'k';
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
}

export function LiveStats() {
    const [stats, setStats] = useState<LiveCounts | null>(null);

    useEffect(() => {
        let cancelled = false;

        // One-shot: tell the API we're here.
        const beacon = () => {
            // Use sendBeacon when available — survives navigation, fire-and-forget.
            const body = JSON.stringify({ path: typeof window !== 'undefined' ? window.location.pathname : '' });
            try {
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(
                        `${API_BASE}/api/v1/visits/track`,
                        new Blob([body], { type: 'application/json' }),
                    );
                    return;
                }
            } catch { /* fall through to fetch */ }
            void fetch(`${API_BASE}/api/v1/visits/track`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true,
            }).catch(() => { /* swallow */ });
        };

        const refresh = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/v1/visits/live`, { cache: 'no-store' });
                if (!res.ok) return;
                const data: LiveCounts = await res.json();
                if (!cancelled) setStats(data);
            } catch { /* swallow */ }
        };

        beacon();
        void refresh();
        const id = setInterval(refresh, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    if (!stats) return null;

    return (
        <div
            className="hidden md:block fixed left-3 z-40 pointer-events-auto select-none bottom-3"
            aria-label="Live visitor stats"
        >
            <div className="flex items-center gap-2 bg-surface-alt/85 backdrop-blur-md border border-rule rounded-full pl-2 pr-3 py-1 text-[10px] font-mono text-slate-300 shadow-lg shadow-black/30 hover:bg-surface-alt transition-colors">
                <span
                    className={`relative inline-flex h-1.5 w-1.5 rounded-full ${stats.now > 0 ? 'bg-buy' : 'bg-slate-600'}`}
                    aria-hidden
                >
                    {stats.now > 0 && (
                        <span className="absolute inline-flex h-full w-full rounded-full bg-buy opacity-60 animate-ping" />
                    )}
                </span>
                <span className="text-white font-semibold">{stats.now}</span>
                <span className="text-slate-500">live</span>
                <span className="text-slate-700">·</span>
                <span className="text-white font-semibold">{compact(stats.today)}</span>
                <span className="text-slate-500">today</span>
                <span className="hidden sm:inline text-slate-700">·</span>
                <span className="hidden sm:inline text-slate-400">{compact(stats.week)}/wk</span>
                <span className="hidden md:inline text-slate-700">·</span>
                <span className="hidden md:inline text-slate-500">{compact(stats.allTime)} total</span>
            </div>
        </div>
    );
}
