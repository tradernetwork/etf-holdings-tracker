/**
 * Static reference data — fund → provider map, AUM table, display ordering.
 *
 * This file has NO server-only imports (no `fs`, no `path`, no `papaparse`)
 * specifically so client components can import from it without dragging the
 * whole CSV-reading layer into the browser bundle. lib/holdings.ts (server
 * only) re-exports these for back-compat.
 *
 * The authoritative source of truth for the provider mapping is
 * api/data.py's FUND_PROVIDERS. Keep this file in sync.
 */

export const FUND_PROVIDERS: Record<string, string> = {
    AVUV: 'Avantis', AVLV: 'Avantis', AVMV: 'Avantis',
    AVEM: 'Avantis', AVDV: 'Avantis', AVDE: 'Avantis', AVUS: 'Avantis', AVSC: 'Avantis', AVES: 'Avantis', AVIV: 'Avantis',
    ARKK: 'ARK Invest', ARKQ: 'ARK Invest', ARKW: 'ARK Invest',
    ARKG: 'ARK Invest', ARKF: 'ARK Invest', ARKX: 'ARK Invest',
    KYLD: 'Kurv', KQQQ: 'Kurv',
    ULTY: 'YieldMax', SLTY: 'YieldMax',
    ULTI: 'REX Shares',
    BLOX: 'Tidal / NicholasX',
    EGGQ: 'Tidal / NestYield', EGGY: 'Tidal / NestYield', EGGS: 'Tidal / NestYield',
    // Weekly pay suite
    MSTW: 'Roundhill', NVDW: 'Roundhill', COIW: 'Roundhill',
    TSLW: 'Roundhill', HOOW: 'Roundhill', PLTW: 'Roundhill',
    QDTE: 'Roundhill', XDTE: 'Roundhill', RDTE: 'Roundhill', YBTC: 'Roundhill',
    MSTY: 'YieldMax', NVDY: 'YieldMax', CONY: 'YieldMax',
    CHPY: 'YieldMax', YMAX: 'YieldMax', AMDY: 'YieldMax', AMZY: 'YieldMax', GOOY: 'YieldMax', GDXY: 'YieldMax',
    TSLY: 'YieldMax', HOOY: 'YieldMax', PLTY: 'YieldMax',
    NVII: 'REX Shares', TSII: 'REX Shares',
    // Corgi Funds — thematic + founder-led (launched May 2026)
    EUV: 'Corgi Funds', CMAG: 'Corgi Funds', CQTM: 'Corgi Funds',
    XA: 'Corgi Funds', EYES: 'Corgi Funds', KYC: 'Corgi Funds',
    GNMX: 'Corgi Funds', AV: 'Corgi Funds', DOCK: 'Corgi Funds',
    WATS: 'Corgi Funds', GLAM: 'Corgi Funds', NYNY: 'Corgi Funds',
    STYL: 'Corgi Funds', WNDR: 'Corgi Funds', FDRS: 'Corgi Funds',
    FDRX: 'Corgi Funds',
    // Sprott — actively managed precious metals miners
    GBUG: 'Sprott',
    // Amplify ETFs — thematic + dividend/income (Firestore feed)
    BLOK: 'Amplify', AIEQ: 'Amplify', ETHO: 'Amplify', IBUY: 'Amplify',
    HACK: 'Amplify', SILJ: 'Amplify', BATT: 'Amplify', IPAY: 'Amplify',
    ITEQ: 'Amplify', COWS: 'Amplify', DRVR: 'Amplify', AWAY: 'Amplify',
    CNBS: 'Amplify', GAMR: 'Amplify', DIVO: 'Amplify', QDVO: 'Amplify',
    IDVO: 'Amplify', YYY: 'Amplify',
    // Capital Group — actively managed, multi-manager active-equity ETFs
    CGDV: 'Capital Group', CGGR: 'Capital Group', CGGO: 'Capital Group',
    CGUS: 'Capital Group', CGXU: 'Capital Group',
    // First Trust — actively managed equity (long/short, market-neutral-adjacent, multi-manager, sub-advised international)
    FTLS: 'First Trust', WCME: 'First Trust', WCMG: 'First Trust',
    WCMI: 'First Trust', CRPT: 'First Trust', MMSC: 'First Trust', EMLP: 'First Trust',
};

export const PROVIDER_ORDER = [
    'Avantis', 'ARK Invest', 'Capital Group', 'Corgi Funds', 'Sprott', 'First Trust', 'Amplify', 'Kurv',
    'YieldMax', 'REX Shares', 'Roundhill', 'Tidal / NicholasX', 'Tidal / NestYield',
];

// Funds removed from scraping — filter any residual data from CSVs.
// IBIT/IVV/IWM: passive ETFs. MSII/COII/HOII/PLTI: REX Growth & Income funds
// liquidated 2026-06-16 (trading halted 2026-06-09). History files kept on disk.
export const EXCLUDED_FUNDS = new Set(['IBIT', 'IVV', 'IWM', 'MSII', 'COII', 'HOII', 'PLTI']);

// Approximate AUM in $B — hand-maintained and NOT authoritative (some
// entries are far understated vs. actual holdings). Kept as the LAST-RESORT
// client-side fallback for when the API's `aum` field (backend's
// get_fund_aum(), served on /api/v1/fund/{t}, /api/v1/ticker/{t}, and signal
// fundDetails) is missing or null for a fund. Since 2026-09-03 the API is
// the single source of truth for AUM — do not resurrect a local per-fund
// derivation here; see etf-dashboard/lib/holdings.ts's header comment.
// Mirrors api/data.py's FUND_AUM — keep in lockstep.
export const FUND_AUM: Record<string, number> = {
    AVUV: 12.5, AVLV: 3.2, AVMV: 0.8,
    // Added 2026-09-03. Third-party estimates — this whole table is known
    // stale (measured up to 14x understated vs summed holdings on 2026-09-03)
    // and feeds convictionScore directly. See docs/REDESIGN-PLAN.md.
    AVEM: 22.0, AVDV: 18.5, AVDE: 15.5, AVUS: 12.0, AVSC: 2.4, AVES: 1.3, AVIV: 0.7,
    CHPY: 1.15, YMAX: 0.38, AMDY: 0.38, AMZY: 0.23, GOOY: 0.23, GDXY: 0.32,
    ARKK: 6.8, ARKQ: 1.1, ARKW: 1.5, ARKG: 1.8, ARKF: 0.9, ARKX: 0.3,
    KYLD: 0.15, KQQQ: 0.1,
    ULTY: 0.5, SLTY: 0.02, ULTI: 0.05, BLOX: 0.02,
    EGGQ: 0.06, EGGY: 0.02, EGGS: 0.02,
    MSTW: 0.05, NVDW: 0.04, COIW: 0.03, TSLW: 0.04, HOOW: 0.02, PLTW: 0.03,
    QDTE: 0.3, XDTE: 0.2, RDTE: 0.1, YBTC: 0.1,
    MSTY: 1.1, NVDY: 1.3, CONY: 0.4, TSLY: 0.9, HOOY: 0.05, PLTY: 0.05,
    NVII: 0.04, TSII: 0.03,
    EUV: 0.05, CMAG: 0.05, CQTM: 0.05, XA: 0.05, EYES: 0.05,
    KYC: 0.05, GNMX: 0.05, AV: 0.05, DOCK: 0.05, WATS: 0.05,
    GLAM: 0.05, NYNY: 0.05, STYL: 0.05, WNDR: 0.05, FDRS: 0.05, FDRX: 0.05,
    // Sprott
    GBUG: 0.16,
    // Amplify (approximate, non-authoritative)
    BLOK: 1.0, AIEQ: 0.1, ETHO: 0.15, IBUY: 0.25, HACK: 0.4, SILJ: 1.2,
    BATT: 0.1, IPAY: 0.5, ITEQ: 0.15, COWS: 0.6, DRVR: 0.15, AWAY: 0.2,
    CNBS: 0.05, GAMR: 0.05, DIVO: 4.0, QDVO: 0.7, IDVO: 0.5, YYY: 0.4,
    // Capital Group (approximate, non-authoritative)
    CGDV: 39.0, CGGR: 25.0, CGGO: 12.0, CGUS: 12.0, CGXU: 6.8,
    // First Trust (approximate, non-authoritative — real AUM auto-derives from holdings once scraped)
    FTLS: 3.0, WCME: 0.1, WCMG: 0.2, WCMI: 0.3, CRPT: 0.05, MMSC: 0.1, EMLP: 1.9,
};

export function getProvider(fund: string): string {
    return FUND_PROVIDERS[fund] ?? 'Other';
}

// Deterministic per-ticker badge color (hash of the fund string into a fixed
// palette) — same fund always renders the same color everywhere it appears,
// with no lookup table to maintain as funds are added. Used by fund badges
// on the dashboard and shared by components/options-table.tsx.
const ETF_BADGE_COLORS = [
    'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'bg-purple-500/20 text-purple-400 border-purple-500/30',
    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    'bg-amber-500/20 text-amber-400 border-amber-500/30',
    'bg-rose-500/20 text-rose-400 border-rose-500/30',
    'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
];

export function getETFColor(fund: string): string {
    let hash = 0;
    for (let i = 0; i < fund.length; i++) hash = fund.charCodeAt(i) + ((hash << 5) - hash);
    return ETF_BADGE_COLORS[Math.abs(hash) % ETF_BADGE_COLORS.length];
}

/**
 * Fund-family category. Mirrors api/data.py's get_fund_category(). Derived
 * from the provider map above, so there's no second table to keep in sync.
 *
 *   active-equity  — picks stocks; the signal is conviction over a week/month
 *   option-income  — sells options for yield; the option book is the story
 */
export type FundCategory = 'active-equity' | 'option-income';

const OPTION_INCOME_PROVIDERS = new Set<string>([
    'Kurv', 'YieldMax', 'REX Shares', 'Roundhill',
    'Tidal / NestYield', 'Tidal / NicholasX',
]);

// Per-fund overrides for providers shipping BOTH product lines. Mirrors
// _OPTION_INCOME_FUNDS in api/data.py — keep the two in lockstep.
const OPTION_INCOME_FUNDS = new Set<string>(['DIVO', 'QDVO', 'IDVO']);

export function getFundCategory(fund: string): FundCategory {
    if (OPTION_INCOME_FUNDS.has(fund)) return 'option-income';
    return OPTION_INCOME_PROVIDERS.has(getProvider(fund))
        ? 'option-income'
        : 'active-equity';
}

export function isIncomeFund(fund: string): boolean {
    return getFundCategory(fund) === 'option-income';
}

export function isEquityFund(fund: string): boolean {
    return getFundCategory(fund) === 'active-equity';
}

/** Filter any row carrying a `fund` field down to one category. */
export function filterByCategory<T extends { fund: string }>(
    rows: T[],
    category: FundCategory | 'all',
): T[] {
    if (category === 'all') return rows;
    return rows.filter(r => getFundCategory(r.fund) === category);
}

/**
 * The two halves of the product. Equity keeps the existing cyan; income gets
 * amber — chosen because it lands within 6% of cyan's contrast on every
 * surface we use (11.44 vs 10.78 on #0a0f1e), so neither world reads as the
 * demoted one. The old purple chip sat a full tier dimmer at 7.02.
 *
 * #f59e0b is already this codebase's covered-call/option colour, so amber
 * promotes an existing semantic rather than inventing a hue.
 *
 * Green/red stay direction-only in BOTH worlds: the accent is where you are,
 * green/red is what happened. Purple stays reserved for cross-cutting meta
 * (divergence, multi-family), never for a category.
 *
 * These literal hex values MIRROR app/globals.css's `--equity` / `--equity-bright`
 * / `--income` / `--income-bright` custom properties — keep the two in lockstep.
 * They stay literal strings rather than `var(--equity)` because the sole
 * consumer (components/site-nav.tsx) does hex+alpha string concatenation
 * (`${meta.accent}26`) that a CSS var() string would break.
 */
export const WORLD_META: Record<FundCategory, {
    label: string;
    short: string;
    blurb: string;
    basePath: string;
    accent: string;
    accentBright: string;
    icon: string;
}> = {
    'active-equity': {
        label: 'Stock Pickers',
        short: 'Pickers',
        blurb: 'Funds that buy things because someone decided to.',
        basePath: '/equity',
        accent: '#00d4ff',
        accentBright: '#7dd3fc',
        icon: '🎯',
    },
    'option-income': {
        label: 'Premium Sellers',
        short: 'Premium',
        blurb: 'Funds that sell options for income. The option book is the story.',
        basePath: '/income',
        accent: '#fbbf24',
        accentBright: '#fcd34d',
        icon: '🪙',
    },
};
