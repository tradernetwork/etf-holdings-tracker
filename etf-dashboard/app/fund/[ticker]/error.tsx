'use client';

// Error boundary for fund profile pages.
//
// api.fund() throws (rather than returning null) when the API has a transient
// failure — a 5xx or network blip that survived three retries. That throw
// lands here. Crucially, Next.js does NOT cache this state: the next request
// re-runs the page, so a fund page recovers on its own once the API is back.
// The "Try again" button lets the current visitor recover immediately.

import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

export default function FundError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Fund page failed to load:', error);
    }, [error]);

    return (
        <div className="min-h-dvh bg-canvas text-foreground p-6 font-sans flex items-center justify-center">
            <div className="max-w-md text-center bg-surface border border-rule rounded-xl p-8 shadow-lg">
                <h1 className="text-2xl font-bold mb-2 text-white">Couldn&apos;t load this fund</h1>
                <p className="text-slate-400 text-sm mb-6">
                    The TickerTrace API didn&apos;t respond in time. This is almost always
                    a brief blip — try again in a moment.
                </p>
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={reset}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-equity text-canvas hover:opacity-90 transition-opacity"
                    >
                        <RefreshCw className="h-4 w-4" /> Try again
                    </button>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-rule-strong text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" /> Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
