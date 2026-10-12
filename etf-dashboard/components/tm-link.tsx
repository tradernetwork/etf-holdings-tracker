'use client';

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { TM_URL, tmHref } from '@/lib/tm';

declare global {
    interface Window { gtag?: (...args: unknown[]) => void }
}

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> & {
    /** Placement id, e.g. "signal_row". Becomes data-placement and the GA4 event param. */
    placement: string;
    ticker?: string;
    children: ReactNode;
};

/** Every outbound TraderMatrix link goes through this: keeps ?ref=MPHINANCE,
 *  sets target/rel, and fires a GA4 outbound_click with the placement id. */
export function TMLink({ placement, ticker, children, onClick, ...rest }: Props) {
    return (
        <a
            {...rest}
            href={ticker ? tmHref(ticker) : TM_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-placement={placement}
            onClick={(e) => {
                window.gtag?.('event', 'outbound_click', { placement, ticker, destination: 'tradermatrix' });
                onClick?.(e);
            }}
        >
            {children}
        </a>
    );
}
