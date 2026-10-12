'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { Zap, TrendingUp, Layers, Coins, LayoutGrid, Star } from 'lucide-react';
import { TickerTraceLockup, TMMark } from '@/components/tm-mark';
import { TMLink } from '@/components/tm-link';
import { useWatchlist } from '@/lib/watchlist';
import { WORLD_META, type FundCategory } from '@/lib/providers';
import { NavSearch } from '@/components/nav-search';

/**
 * Shared app navigation — one familiar top bar across every data page.
 * The marketing landing page (app/page.tsx) keeps its own commercial nav and
 * is NOT affected by this component.
 *
 * Redesign (2026-09-03, docs/REDESIGN-PLAN.md Phase 3): the nav used to be
 * organised around the Stock Pickers / Premium Sellers world split, but
 * /dashboard and /funds — the pages every CTA and the logo point at — render
 * with no world at all. Equity-vs-income is a *computation* boundary (active
 * weight math differs for a covered-call writer vs. a stock picker); it is a
 * poor primary navigation axis. The five destinations below are the task
 * axis instead: what a trader came here to find. Equity/income survives as
 * the `WorldChip` filter below, not as the top-level fork.
 */

export type World = FundCategory;

export type Destination = {
    key: string;
    label: string;
    href: string;
    icon: ComponentType<{ className?: string }>;
    /** Path prefixes this destination owns, including absorbed sub-routes. */
    prefixes: string[];
};

// Five destinations, ordered by frequency of intent — decided in
// docs/REDESIGN-PLAN.md, not open for relitigation here. A bottom tab bar
// tops out at five, so this list IS the mobile nav (see bottom-nav.tsx) as
// well as the desktop row below.
export const DESTINATIONS: Destination[] = [
    { key: 'signals', label: 'Signals', href: '/dashboard', icon: Zap, prefixes: ['/dashboard', '/changes', '/layering', '/equity'] },
    { key: 'stocks', label: 'Stocks', href: '/stocks', icon: TrendingUp, prefixes: ['/stocks'] },
    { key: 'funds', label: 'Funds', href: '/funds', icon: Layers, prefixes: ['/funds', '/fund'] },
    { key: 'income', label: 'Income', href: '/income', icon: Coins, prefixes: ['/income', '/effectiveness', '/options-listings'] },
    { key: 'holdings', label: 'Holdings', href: '/holdings', icon: LayoutGrid, prefixes: ['/holdings'] },
];

// Sub-routes absorbed into a destination that don't have their own nav slot
// but still need to stay reachable without a URL bar. De-jargoned per the
// plan: "Δ Changes" → "Changes", "CBOE Scanner" → "New Listings", "Fund
// Scores" → "Scores". "Layering" stays — an owned product concept with
// changelog and marketing continuity, not decoration to trim.
const CONTEXT_LINKS: Record<string, { href: string; label: string }[]> = {
    signals: [
        { href: '/changes', label: 'Changes' },
        { href: '/layering', label: 'Layering' },
    ],
    income: [
        { href: '/options-listings', label: 'New Listings' },
        { href: '/effectiveness', label: 'Scores' },
    ],
};

// Destinations where the equity/income split still matters enough to offer
// as a filter. Not shown on Income (you're already in that world) or
// Holdings (the raw grid spans both on purpose).
const WORLD_CHIP_DESTINATIONS = new Set(['signals', 'stocks', 'funds']);

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isDestinationActive(d: Destination, pathname: string): boolean {
    return d.prefixes.some(p => pathMatchesPrefix(pathname, p));
}

export function getActiveDestination(pathname: string): Destination | null {
    return DESTINATIONS.find(d => isDestinationActive(d, pathname)) ?? null;
}

function inferWorld(pathname: string): World | null {
    if (pathname.startsWith('/equity')) return 'active-equity';
    if (pathname.startsWith('/income')) return 'option-income';
    return null;
}

const WORLDS: World[] = ['active-equity', 'option-income'];

/** Stock Pickers / Premium Sellers — demoted from a top-level fork to a
 *  filter chip. Same vocabulary, same routes (/equity, /income), just no
 *  longer the thing you have to pick before you can navigate at all. */
function WorldChip({ activeWorld }: { activeWorld: World | null }) {
    return (
        <div className="flex items-center gap-1 rounded-lg bg-surface-alt border border-rule-strong p-0.5 shrink-0">
            {WORLDS.map(w => {
                const meta = WORLD_META[w];
                const on = activeWorld === w;
                return (
                    <Link
                        key={w}
                        href={meta.basePath}
                        title={meta.blurb}
                        className="inline-flex items-center min-h-11 md:min-h-0 text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors whitespace-nowrap"
                        style={on
                            ? { backgroundColor: `${meta.accent}26`, color: meta.accent }
                            : { color: 'var(--subtext)' }}
                    >
                        <span aria-hidden>{meta.icon}</span>{' '}
                        <span className="hidden lg:inline">{meta.label}</span>
                        <span className="lg:hidden">{meta.short}</span>
                    </Link>
                );
            })}
        </div>
    );
}

function ContextLinks({ links, pathname }: { links: { href: string; label: string }[]; pathname: string }) {
    return (
        <>
            {links.map(l => {
                const isActive = pathname === l.href;
                return (
                    <Link
                        key={l.href}
                        href={l.href}
                        className={`inline-flex items-center min-h-11 md:min-h-0 text-xs font-medium px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${isActive
                            ? 'bg-equity/15 border-equity/40 text-equity'
                            : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                    >
                        {l.label}
                    </Link>
                );
            })}
        </>
    );
}

/**
 * The persistent CTA to TraderMatrix.pro, referral code intact
 * (?ref=MPHINANCE). Per funnel-guard: a CTA that loses its ref code
 * converts and pays nobody — confirmed live and load-bearing (109
 * referrals attributed to MPHINANCE in prod as of 2026-09-03). Do not
 * append utm_source: tradermatrix.pro's captureUtmParams() explicitly
 * skips UTM capture whenever ?ref= is present and synthesises its own
 * utm_source="referral" instead, so an appended param would be silently
 * discarded — just a longer URL for nothing. It stays in this top row —
 * sticky, on every route, at every width — rather than competing for one
 * of the five bottom tab bar slots on mobile, which are reserved for the
 * decided destinations. A sticky top bar means it's still reachable after
 * scrolling on a phone, same guarantee the bottom bar gives the five
 * destinations.
 */
function TraderMatrixCTA() {
    return (
        <TMLink
            placement="nav_cta"
            title="We track the moves. TraderMatrix helps you trade them."
            className="inline-flex items-center justify-center gap-1.5 px-2.5 min-h-11 min-w-11 md:min-h-9 md:min-w-0 sm:px-3 text-[11px] sm:text-xs font-bold rounded-[10px] border border-tm-gold/40 bg-gradient-to-r from-tm-gold/15 to-tm-steel/5 text-tm-gold-bright hover:text-white hover:border-tm-gold/70 transition-colors whitespace-nowrap shrink-0"
        >
            <TMMark size={16} />
            <span className="hidden lg:inline">Trade it on TraderMatrix →</span>
            <span className="hidden min-[370px]:inline lg:hidden" aria-label="TraderMatrix">→</span>
        </TMLink>
    );
}

/** Star + count badge, on every page. The list lives in this browser only. */
function WatchlistLink({ pathname }: { pathname: string }) {
    const { items } = useWatchlist();
    const on = pathname === '/watchlist';
    return (
        <Link
            href="/watchlist"
            aria-label={`Watchlist, ${items.length} saved`}
            title="Your watchlist"
            className={`relative ml-auto md:ml-0 inline-flex h-11 w-11 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-[10px] border bg-surface-alt transition-colors ${on ? 'border-tm-gold/50 text-tm-gold-bright' : 'border-rule-strong text-subtext hover:text-white'}`}
        >
            <Star className="h-4 w-4" />
            {items.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-tm-gold px-1 text-[9px] font-extrabold text-canvas">
                    {items.length}
                </span>
            )}
        </Link>
    );
}

export function SiteNav({ world }: { world?: World } = {}) {
    const pathname = usePathname();
    const active = getActiveDestination(pathname);
    const activeWorld: World | null = world ?? inferWorld(pathname);
    const showWorldChip = active !== null && WORLD_CHIP_DESTINATIONS.has(active.key);
    const contextLinks = active ? (CONTEXT_LINKS[active.key] ?? []) : [];

    return (
        <nav className="sticky top-0 z-50 bg-surface/95 backdrop-blur-md border border-rule rounded-xl shadow-lg">
            {/* Row 1 — identity, the five destinations (md+ only; mobile gets
                the fixed bottom bar instead), search, and the TraderMatrix
                CTA. Kept deliberately light on mobile (logo + search + CTA)
                so it never needs to scroll to stay reachable — the old rail
                here existed only because the world switcher, five shared
                links, and the CTA all had to fit in one row on a phone. */}
            <div className="px-3 sm:px-4 py-2.5 flex items-center gap-1 sm:gap-3">
                <Link
                    href="/dashboard"
                    className="shrink-0 hover:opacity-80 transition-opacity"
                    aria-label="TickerTrace, a TraderMatrix product"
                >
                    <span className="sm:hidden"><TickerTraceLockup size="sm" /></span>
                    <span className="hidden sm:inline"><TickerTraceLockup size="md" /></span>
                </Link>

                <div className="hidden md:flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                    {DESTINATIONS.map(d => {
                        const isActive = active?.key === d.key;
                        const Icon = d.icon;
                        return (
                            <Link
                                key={d.key}
                                href={d.href}
                                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${isActive
                                    ? 'bg-equity/15 border-equity/40 text-equity'
                                    : 'bg-surface-elevated border-rule-strong text-slate-400 hover:text-white'}`}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {d.label}
                            </Link>
                        );
                    })}
                    {showWorldChip && <WorldChip activeWorld={activeWorld} />}
                </div>

                {/* The star's ml-auto pushes star + search + CTA to the right
                    edge on mobile, where the destination row is hidden. No
                    flex-1 spacer: its extra gap cost 6px the row can't spare. */}
                <WatchlistLink pathname={pathname} />
                <NavSearch />
                <TraderMatrixCTA />
            </div>

            {/* Row 2 — world chip (mobile only; desktop shows it inline in
                row 1) and the absorbed sub-routes (Changes/Layering under
                Signals, New Listings/Scores under Income) share ONE
                wrapping row. Two stacked bordered rows cost a phone ~60px
                of first-screen height for a handful of short pills. */}
            {(showWorldChip || contextLinks.length > 0) && (
                <div className="px-3 sm:px-4 pb-2.5 flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] md:flex-wrap md:overflow-visible border-t border-rule/60 pt-2">
                    {showWorldChip && (
                        <div className="md:hidden shrink-0">
                            <WorldChip activeWorld={activeWorld} />
                        </div>
                    )}
                    <ContextLinks links={contextLinks} pathname={pathname} />
                </div>
            )}
        </nav>
    );
}
