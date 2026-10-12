'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type WatchItem = { type: 'stock' | 'fund'; symbol: string };

const KEY = 'tt_watchlist';
const listeners = new Set<() => void>();
const EMPTY: WatchItem[] = [];
let cache: { raw: string | null; items: WatchItem[] } = { raw: null, items: EMPTY };

function read(): WatchItem[] {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw === cache.raw) return cache.items;
        const parsed = raw ? JSON.parse(raw) : [];
        cache = { raw, items: Array.isArray(parsed) ? parsed : EMPTY };
        return cache.items;
    } catch {
        return EMPTY;
    }
}

function write(items: WatchItem[]) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
    listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    window.addEventListener('storage', cb);
    return () => { listeners.delete(cb); window.removeEventListener('storage', cb); };
}

/** Browser-only watchlist (no login). Stars on any page share this list. */
export function useWatchlist() {
    const items = useSyncExternalStore(subscribe, read, () => EMPTY);
    const has = useCallback((type: WatchItem['type'], symbol: string) =>
        items.some(i => i.type === type && i.symbol === symbol), [items]);
    const toggle = useCallback((type: WatchItem['type'], symbol: string) => {
        const cur = read();
        write(cur.some(i => i.type === type && i.symbol === symbol)
            ? cur.filter(i => !(i.type === type && i.symbol === symbol))
            : [...cur, { type, symbol }]);
    }, []);
    return { items, has, toggle };
}
