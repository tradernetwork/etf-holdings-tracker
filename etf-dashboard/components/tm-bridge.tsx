import type { ReactNode } from 'react';
import { TMMark } from '@/components/tm-mark';
import { TMLink } from '@/components/tm-link';

/** Full-width gold bridge card: mark, one honest sentence, one button.
 *  `compact` renders the slim banner variant (a single linked row). */
export function TMBridge({ placement, title, body, cta, ticker, compact = false }: {
    placement: string;
    title: ReactNode;
    body: ReactNode;
    cta: string;
    ticker?: string;
    compact?: boolean;
}) {
    if (compact) {
        return (
            <TMLink
                placement={placement}
                ticker={ticker}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-tm-gold/30 bg-gradient-to-r from-tm-gold/[.08] to-transparent px-4 py-3 hover:border-tm-gold/60 transition-colors"
            >
                <TMMark size={24} />
                <span className="flex-1 min-w-[200px] text-[13px] text-slate-300">
                    <span className="font-bold text-tm-gold-bright">{title}</span> {body}
                </span>
                <span className="text-xs font-extrabold text-tm-gold-bright whitespace-nowrap">{cta}</span>
            </TMLink>
        );
    }
    return (
        <TMLink
            placement={placement}
            ticker={ticker}
            className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-tm-gold/35 bg-tm-gold/5 p-4 hover:border-tm-gold/60 transition-colors"
        >
            <TMMark size={28} />
            <span className="flex-1 min-w-[220px]">
                <span className="block text-sm font-bold text-white">{title}</span>
                <span className="block text-xs text-subtext">{body}</span>
            </span>
            <span className="rounded-xl bg-tm-gold px-4 py-2 text-[13px] font-extrabold text-canvas whitespace-nowrap">{cta}</span>
        </TMLink>
    );
}
