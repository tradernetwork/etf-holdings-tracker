import Link from 'next/link';
import { API_BASE } from '@/lib/api';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import type { ReactNode } from 'react';
interface Position {
    fund: string; ticker: string; name: string; weight: number; shares: number | null;
    sharesDelta: number | null; weightDelta: number | null; activeWeightDelta?: number | null;
    marketValue?: number | null; positionUsd?: number | null;
    stale?: boolean; refreshed?: boolean | null; isOption: boolean; underlying?: string | null; assetClass?: string; optionType?: string | null;
}
/** Full guarded book, not the fund-detail endpoint's top-20 excerpt. */
export async function FundHoldings({ fund, fallback }: { fund: string; fallback: ReactNode }) {
    let positions: Position[] | null = null;
    let asOfDate: string | undefined;
    try {
        const response = await fetch(`${API_BASE}/api/v1/holdings?fund=${encodeURIComponent(fund)}&sort=weight`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(15000) });
        if (response.ok) {
            const payload = await response.json();
            if (Array.isArray(payload.holdings) && payload.holdings.every((p: Position) => p.fund === fund)) {
                positions = payload.holdings;
                asOfDate = payload.asOfDate;
            }
        }
    } catch { /* Keep the labelled excerpt if the full book cannot be loaded. */ }
    if (!positions) return <>{fallback}<Link href={`/holdings?fund=${fund}`} className="text-equity">Open the full holdings browser →</Link></>;
    const columns: DataTableColumn[] = [
        { key: 'ticker', header: 'Position' }, { key: 'shares', header: 'Shares / contracts', align: 'right' },
        { key: 'delta', header: 'Δ shares', align: 'right' }, { key: 'value', header: 'Market value', align: 'right' },
        { key: 'weight', header: 'Weight', align: 'right' }, { key: 'active', header: 'Δ active pp', align: 'right' },
    ];
    return <section className="rounded-xl border border-rule bg-surface overflow-hidden">
        <div className="p-4 flex flex-wrap items-center gap-3">
            <h2 className="font-bold">Portfolio holdings · {positions.length} positions</h2>
            <Link href={`/holdings?fund=${fund}`} className="text-xs text-equity">Filters and full book →</Link>
            <a href={`${API_BASE}/api/v1/holdings?fund=${fund}&format=csv`} className="text-xs text-equity">Export CSV</a>
            <p className="text-xs text-slate-500 w-full">Snapshot {asOfDate ?? 'unknown'}. All positions, not a top-20 excerpt. Swipe for every column. Unknown and catch-up changes show —; estimates are labelled.</p>
        </div>
        <DataTable className="min-w-[750px] [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:bg-surface [&_td:first-child]:z-10 [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:bg-surface [&_th:first-child]:z-10" columns={columns} rows={positions.map(p => {
            const withheld = p.stale || p.refreshed === false;
            const delta = withheld ? null : p.activeWeightDelta ?? p.weightDelta;
            const value = p.marketValue ?? p.positionUsd;
            return { key: p.ticker, cells: {
                ticker: <div><Link href={`/stocks/${encodeURIComponent(p.underlying ?? p.ticker)}`} className="font-mono font-bold text-equity">{p.ticker}</Link><p className="text-xs text-slate-500 max-w-[180px] truncate">{p.isOption ? p.optionType : p.assetClass} · {p.name}</p></div>,
                shares: p.shares == null ? '—' : p.shares.toLocaleString(),
                delta: withheld || p.sharesDelta == null ? '—' : `${p.sharesDelta > 0 ? '+' : ''}${p.sharesDelta.toLocaleString()}`,
                value: value == null ? '—' : `${p.marketValue == null ? 'est. ' : ''}${value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`,
                weight: `${p.weight.toFixed(3)}%`, active: delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(3)}`,
            } };
        })} />
    </section>;
}
