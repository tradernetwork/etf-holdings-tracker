'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { DESTINATIONS, getActiveDestination } from '@/components/site-nav';
import { TMMark } from '@/components/tm-mark';
import { TMLink } from '@/components/tm-link';

/**
 * Fixed five-item bottom tab bar for phones — replaces the three
 * horizontally-scrolling rails that used to stack in site-nav.tsx
 * (docs/REDESIGN-PLAN.md Phase 3). Mounted once from app/layout.tsx so
 * every data route gets it without per-page wiring, and so the spacer that
 * reserves its height lives in one place instead of being copy-pasted onto
 * every page's outer div.
 *
 * Hidden on the landing page ('/'), which keeps its own commercial nav and
 * CTA structure (see site-nav.tsx's top comment) — a second nav system
 * competing with that page's own funnel would work against it, not with it.
 */
const STRIP_KEY = 'tt_flow_strip_hidden_until';
const WEEK_MS = 7 * 24 * 3600 * 1000;
// Pages that already carry their own flow panel never get the strip.
const NO_STRIP = ['/stocks/', '/income/', '/effectiveness', '/options-listings', '/holdings', '/watchlist'];

const stripListeners = new Set<() => void>();
function stripHidden(): boolean {
    try { return Number(localStorage.getItem(STRIP_KEY) ?? 0) > Date.now(); } catch { return false; }
}
function subscribeStrip(cb: () => void) {
    stripListeners.add(cb);
    return () => { stripListeners.delete(cb); };
}
function dismissStrip() {
    try { localStorage.setItem(STRIP_KEY, String(Date.now() + WEEK_MS)); } catch { /* private mode */ }
    stripListeners.forEach(l => l());
}

function FlowStrip() {
    // Server snapshot says hidden so the strip never flashes for a dismissed visitor.
    const hidden = useSyncExternalStore(subscribeStrip, stripHidden, () => true);
    if (hidden) return null;
    const title = 'Did the options tape agree?';
    const body = 'See the live flow behind today’s ETF buys';
    return (
        <div className="flex items-center gap-2.5 border-t border-tm-gold/35 bg-[#14161c] py-2 pl-3 pr-1.5">
            <TMMark size={26} className="shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-white">{title}</div>
                <div className="truncate text-[11px] text-subtext">{body}</div>
            </div>
            <TMLink placement="mobile_strip" className="inline-flex min-h-11 shrink-0 items-center rounded-[10px] bg-tm-gold px-3.5 text-xs font-extrabold text-canvas">Open</TMLink>
            <button type="button" onClick={dismissStrip} aria-label="Dismiss for 7 days" className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-500">
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

export function BottomNav() {
    const pathname = usePathname();
    if (pathname === '/') return null;
    const showStrip = !NO_STRIP.some(p => pathname === p || pathname.startsWith(p));

    const active = getActiveDestination(pathname);

    return (
        <>
            {/* Reserves the space the fixed bar below occupies, so it never
                sits on top of page content. Lives here — once, via layout —
                rather than as bottom padding a per-page file would have to
                remember to add. */}
            <div aria-hidden className="md:hidden" style={{ height: `calc(${showStrip ? '8.75rem' : '4rem'} + env(safe-area-inset-bottom))` }} />

            <div className="md:hidden fixed inset-x-0 bottom-0 z-50">
            {showStrip && <FlowStrip />}
            <nav
                className="grid grid-cols-5 bg-surface/97 backdrop-blur-md border-t border-rule"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                aria-label="Primary"
            >
                {DESTINATIONS.map(d => {
                    const Icon = d.icon;
                    const isActive = active?.key === d.key;
                    return (
                        <Link
                            key={d.key}
                            href={d.href}
                            aria-current={isActive ? 'page' : undefined}
                            // min-h-16 (64px) keeps the tap target well past the
                            // 44px floor even with the safe-area padding above.
                            className="relative flex flex-col items-center justify-center gap-1 min-h-16 text-[11px] font-semibold transition-colors"
                            style={{ color: isActive ? 'var(--equity)' : '#64748b' }}
                        >
                            {isActive && (
                                <span
                                    aria-hidden
                                    className="absolute top-0 inset-x-4 h-0.5 rounded-full"
                                    style={{ backgroundColor: 'var(--equity)' }}
                                />
                            )}
                            <Icon className="h-5 w-5" />
                            <span>{d.label}</span>
                        </Link>
                    );
                })}
            </nav>
            </div>
        </>
    );
}
