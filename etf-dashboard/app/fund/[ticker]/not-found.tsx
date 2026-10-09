// Branded not-found for the fund route.
//
// This renders ONLY when api.fund() resolved to a genuine 404 — the ticker
// truly isn't a fund TickerTrace covers. A transient API failure goes to
// error.tsx instead (it throws rather than 404s), so the two states never
// get confused: this page never shows for a fund that actually exists.
//
// Server component — the search box is a plain GET form, no client JS needed.

import { ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';

export default function FundNotFound() {
    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 font-sans flex items-center justify-center">
            <div className="max-w-md w-full text-center bg-surface border border-rule rounded-xl p-8 shadow-lg">
                <div className="text-5xl font-black font-mono text-rule mb-3">404</div>
                <h1 className="text-2xl font-bold mb-2 text-white">Fund not found</h1>
                <p className="text-slate-400 text-sm mb-6">
                    We don&apos;t track that ticker — or it isn&apos;t a fund TickerTrace
                    covers. Search for a ticker, or head back to the dashboard.
                </p>
                <form action="/dashboard" method="get" className="flex gap-2 mb-5">
                    <input
                        name="q"
                        placeholder="Search a ticker — TSLA, ARKK, NVDA…"
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
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" /> Back to dashboard
                </Link>
            </div>
        </div>
    );
}
