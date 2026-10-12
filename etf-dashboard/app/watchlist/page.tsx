import type { Metadata } from 'next';
import { WatchlistClient } from './watchlist-client';

export const metadata: Metadata = {
    title: 'Your Watchlist — TickerTrace',
    description: 'Institutional flow for the tickers you follow. No login needed — saved in your browser.',
    openGraph: {
        title: 'Your Watchlist — TickerTrace',
        description: 'Star any ticker or fund to track institutional flow here.',
    },
};

export default function WatchlistPage() {
    return <WatchlistClient />;
}
