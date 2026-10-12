'use client';

import { Star } from 'lucide-react';
import { useWatchlist, type WatchItem } from '@/lib/watchlist';

export function WatchStar({ type = 'stock', symbol }: { type?: WatchItem['type']; symbol: string }) {
    const { has, toggle } = useWatchlist();
    const on = has(type, symbol);
    return (
        <button
            type="button"
            onClick={() => toggle(type, symbol)}
            aria-pressed={on}
            aria-label={`${on ? 'Remove' : 'Add'} ${symbol} ${on ? 'from' : 'to'} watchlist`}
            className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center -m-1 p-1 box-content after:absolute after:-inset-1.5 after:content-['']"
        >
            <Star className={`h-3.5 w-3.5 ${on ? 'fill-tm-gold text-tm-gold' : 'text-slate-600 hover:text-slate-400'}`} />
        </button>
    );
}

/** Text+icon "Watch / Watching" toggle for page headers. */
export function WatchButton({ type = 'stock', symbol, onLabel = 'Watching', offLabel = 'Watch' }: { type?: WatchItem['type']; symbol: string; onLabel?: string; offLabel?: string }) {
    const { has, toggle } = useWatchlist();
    const on = has(type, symbol);
    return (
        <button
            type="button"
            onClick={() => toggle(type, symbol)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 min-h-11 md:min-h-0 px-3 py-2 rounded-xl border text-xs font-bold ${on
                ? 'border-tm-gold/50 bg-tm-gold/10 text-tm-gold-bright'
                : 'border-rule-strong bg-surface-alt text-subtext hover:text-white'}`}
        >
            <Star className={`h-3.5 w-3.5 ${on ? 'fill-tm-gold' : ''}`} />
            {on ? onLabel : offLabel}
        </button>
    );
}
