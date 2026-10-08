'use client';

import { useEffect } from 'react';

/** Registers /sw.js so the app is installable and has an offline fallback. */
export function SwRegister() {
    useEffect(() => {
        if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        }
    }, []);
    return null;
}
