// Mirrors etf-dashboard/lib/tm.ts. ?ref=MPHINANCE is load-bearing (funnel-guard): never add UTM params.
export const TM_URL = "https://www.tradermatrix.pro/?ref=MPHINANCE";
export const TM_GOLD = "#E0B03A";

/** Per-ticker TraderMatrix live-flow page; homepage if the symbol looks odd. */
export function tmHref(ticker?: string): string {
  const t = ticker?.trim().toUpperCase();
  if (!t || !/^[A-Z0-9.\-]{1,12}$/.test(t)) return TM_URL;
  return `https://www.tradermatrix.pro/live-flow/${encodeURIComponent(t)}?ref=MPHINANCE`;
}
