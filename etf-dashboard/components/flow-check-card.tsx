import Link from 'next/link';
import { Lock } from 'lucide-react';
import { TMMark } from '@/components/tm-mark';
import { TMLink } from '@/components/tm-link';

export type FlowCheckRow = { ticker: string; name: string; etf: string; etfSub: string };

/** "Did the options tape agree?" Today's top ETF buys next to a flow cell that
 *  is ALWAYS blurred and locked. Only live options tape is teased here; our ETF holdings stay visible. The cell
 *  is meaningless filler and the link says where the real thing lives. */
export function FlowCheckCard({ rows, headerPlacement = 'flowcheck_header' }: { rows: FlowCheckRow[]; headerPlacement?: string }) {
    if (!rows.length) return null;
    return (
        <div className="overflow-hidden rounded-2xl border border-tm-gold/30 bg-gradient-to-r from-surface via-[#14161c] to-[#18160f]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <TMMark size={22} />
                    <div>
                        <h2 className="text-sm font-black tracking-tight">
                            Flow check <span className="text-tm-gold-bright">— did the options tape agree?</span>
                        </h2>
                        <p className="mt-0.5 text-[11px] text-slate-500">Today&apos;s top ETF buys, checked against live sweeps &amp; blocks on TraderMatrix.</p>
                    </div>
                </div>
                <TMLink placement={headerPlacement} className="inline-flex min-h-11 md:min-h-0 items-center rounded-xl bg-tm-gold px-3.5 py-2 text-xs font-extrabold text-canvas whitespace-nowrap hover:bg-tm-gold-bright transition-colors">
                    Open live flow →
                </TMLink>
            </div>
            {rows.map(r => (
                <div key={r.ticker} className="grid grid-cols-[1fr_1fr] md:grid-cols-[minmax(140px,1.2fr)_minmax(120px,1fr)_minmax(160px,1.4fr)_auto] items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                        <Link href={`/stocks/${r.ticker}`} className="relative font-mono text-sm font-bold text-equity after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-['']">{r.ticker}</Link>
                        <p className="truncate text-[11px] text-slate-500">{r.name}</p>
                    </div>
                    <div className="block font-mono text-[11px] leading-4">
                        <span className="text-slate-500">ETF</span> <span className="font-semibold text-buy">{r.etf}</span><br />
                        <span className="text-slate-600">{r.etfSub}</span>
                    </div>
                    <div className="hidden md:flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[11px] text-slate-500">FLOW</span>
                        <span aria-hidden className="flex gap-1.5 select-none blur-[3.5px]">
                            <span className="whitespace-nowrap rounded-full border border-tm-gold/40 px-2 py-0.5 text-[10px] font-bold text-tm-gold-bright">XXXXX XXXXX</span>
                            <span className="whitespace-nowrap font-mono text-[11px] text-slate-200">$0.0M calls</span>
                        </span>
                        <Lock className="h-3 w-3 shrink-0 text-tm-gold" aria-label="Locked, see it on TraderMatrix" />
                    </div>
                    <TMLink placement="flowcheck_row" ticker={r.ticker} className="inline-flex min-h-11 md:min-h-0 items-center text-[11px] font-bold text-tm-gold-bright whitespace-nowrap text-right">
                        See it on TraderMatrix →
                    </TMLink>
                </div>
            ))}
            <p className="px-4 pb-2.5 pt-2 text-[10px] text-slate-500">Flow details live on TraderMatrix. Referral link disclosed.</p>
        </div>
    );
}
