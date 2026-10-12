import { TMMark } from '@/components/tm-mark';
import { TMLink } from '@/components/tm-link';

/** Row-level bridge. TickerTrace never shows flow data: this only points to
 *  where it lives.
 *
 *  Touch target: the pill is ~19px tall, so by default an invisible ::after
 *  halo stretches the hit area to ~47px. `compact` is for pills sitting among
 *  other tap targets (wrapping pill rows, a line under a ticker link) where
 *  that halo would steal taps from neighbours; it grows the pill instead. */
export function FlowChip({ placement, ticker, label = 'Check flow ↗', icon = true, compact = false }: {
    placement: string;
    ticker?: string;
    label?: string;
    icon?: boolean;
    compact?: boolean;
}) {
    const size = compact ? 'py-1' : "py-px after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']";
    return (
        <TMLink
            placement={placement}
            ticker={ticker}
            className={`relative inline-flex items-center gap-1 rounded-full border border-tm-gold/30 bg-tm-gold/5 px-2 ${size} text-[10px] font-bold whitespace-nowrap text-tm-gold-bright transition-colors hover:border-tm-gold/70 hover:text-white`}
        >
            {icon && <TMMark size={10} />}
            {label}
        </TMLink>
    );
}
