/** One place for the TraderMatrix hand-off URL. The ref code is load-bearing
 *  (funnel-guard): never append UTM params, tradermatrix.pro drops them when
 *  ?ref= is present. */
export const TM_URL = 'https://www.tradermatrix.pro/?ref=MPHINANCE';

/** Per-ticker deep link: TraderMatrix's live-flow page for that symbol (200, no
 *  redirect, ref kept; verified 2026-10-12). Falls back to the homepage. */
export function tmHref(ticker?: string): string {
    const t = ticker?.trim().toUpperCase();
    if (!t || !/^[A-Z0-9.\-]{1,12}$/.test(t)) return TM_URL;
    return `https://www.tradermatrix.pro/live-flow/${encodeURIComponent(t)}?ref=MPHINANCE`;
}
