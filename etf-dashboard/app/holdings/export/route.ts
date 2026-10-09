import { filterAndSort, parseHoldingsQuery, HOLDINGS_COLUMNS } from '@/lib/holdings-query';

export const dynamic = 'force-dynamic';

// CSV of everything matching the current /holdings filters (all pages).
export async function GET(req: Request) {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const { rows } = filterAndSort(parseHoldingsQuery(params));
    const esc = (v: unknown) => {
        if (v == null) return '';
        const s = String(v);
        return typeof v === 'string' ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = [
        HOLDINGS_COLUMNS.join(','),
        ...rows.map(r => HOLDINGS_COLUMNS.map(c => esc(r[c])).join(',')),
    ].join('\n');
    return new Response(body, {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="holdings_export_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
    });
}
