// Branded not-found for the stock detail route.
//
// Renders when api.stock() returns null — the ticker genuinely isn't in
// TickerTrace's tracked holdings. A transient API failure throws instead,
// landing in error.tsx. The two states never get confused.
//
// Server component — the search box is a plain GET form, no client JS needed.

import { ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';

export default function StockNotFound() {
    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 font-sans flex items-center justify-center">
            <div className="max-w-md w-full text-center bg-surface border border-rule rounded-xl p-8 shadow-lg">
                <div className="text-5xl font-black font-mono text-rule mb-3">404</div>
                <h1 className="text-2xl font-bold mb-2 text-white">Stock not found</h1>
                <p className="text-slate-400 text-sm mb-6">
                    That ticker isn&apos;t in TickerTrace&apos;s tracked holdings — it may not
                    be held by any fund we follow, or the symbol may be off.
                    Search for a ticker, or browse the full stocks list.
                </p>
                <form action="/dashboard" method="get" className="flex gap-2 mb-5">
                    <input
                        name="q"
                        placeholder="Search a ticker — TSLA, NVDA, MSFT…"
                        aria-label="Search a ticker"
                        className="flex-1 bg-surface-alt border border-rule-strong rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-equity transition-colors"
                    />
                    <button
                        type="submit"
                        aria-label="Search"
                        className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-equity text-canvas hover:opacity-90 transition-opacity"
                    >
                        <Search className="h-4 w-4" />
                    </button>
                </form>
                <div className="flex items-center justify-center gap-4">
                    <Link
                        href="/stocks"
                        className="inline-flex items-center gap-1.5 text-sm text-equity hover:text-white transition-colors"
                    >
                        Browse all stocks →
                    </Link>
                    <span className="text-slate-700">·</span>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" /> Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
