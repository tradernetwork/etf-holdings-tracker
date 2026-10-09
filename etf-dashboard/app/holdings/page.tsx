import { DataTable } from './data-table';
import { columns } from './columns';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { parseHoldingsQuery, queryHoldings } from '@/lib/holdings-query';

// Server-paginated: reads searchParams, so it renders per request and only
// ever ships one page of rows (the full book was 20+ MB and broke the build).
export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
}

export default async function HoldingsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const result = queryHoldings(parseHoldingsQuery(await searchParams));
    const { asOfDate, activeCount, changedCount } = result;

    return (
        <div className="min-h-screen bg-canvas text-foreground p-6 font-sans">
            <div className="max-w-[1600px] mx-auto space-y-4">
                <SiteNav />
                <Link href="/dashboard" className="inline-flex items-center text-sm font-medium text-slate-400 hover:text-white mb-2 transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
                </Link>
                <div className="flex justify-between items-end mb-6">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                            Full Holdings Database
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            {asOfDate && <span className="font-mono">{formatDate(asOfDate)} · </span>}
                            {activeCount.toLocaleString()} active positions across all tracked funds
                            {changedCount > 0 && (
                                <span className="text-equity ml-2">· {changedCount} changed today</span>
                            )}
                        </p>
                    </div>
                </div>

                <div className="bg-surface border border-rule rounded-xl overflow-hidden shadow-xl p-4">
                    <DataTable columns={columns} result={result} />
                </div>
            </div>
        </div>
    );
}
