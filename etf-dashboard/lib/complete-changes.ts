import type { ApiChangeRecord } from './api';
interface Page { asOfDate: string; previousDate?: string | null; comparisonTradingDays?: number | null; changes: ApiChangeRecord[]; pages: number; snapshot: string }
/** Complete book, bounded to three concurrent pages; never mix daily snapshots. */
export async function completeChanges(period: string) {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.tickertrace.pro';
    async function load(page: number, snapshot?: string): Promise<Page> {
        const q = new URLSearchParams({ period, page: String(page), size: '2000' });
        if (snapshot) q.set('snapshot', snapshot);
        const r = await fetch(`${base}/api/v1/changes?${q}`, { cache: 'no-store', headers: { 'X-TickerTrace-Client': 'web' } });
        if (!r.ok) throw new Error('Complete changes unavailable; reload the snapshot');
        return r.json();
    }
    const first = await load(1);
    if (!first.pages || !first.snapshot) throw new Error('Server does not support complete paging');
    const changes = [...first.changes];
    for (let page = 2; page <= first.pages; page += 3) {
        const batch = await Promise.all(Array.from({ length: Math.min(3, first.pages - page + 1) }, (_, i) => load(page + i, first.snapshot)));
        for (const p of batch) {
            if (p.snapshot !== first.snapshot || p.asOfDate !== first.asOfDate) throw new Error('Snapshot changed; reload');
            changes.push(...p.changes);
        }
    }
    return { asOfDate: first.asOfDate, previousDate: first.previousDate ?? null, comparisonTradingDays: first.comparisonTradingDays ?? null, changes };
}
