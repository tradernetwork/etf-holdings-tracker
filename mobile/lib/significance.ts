/**
 * Which position changes are worth showing. Mirrors `_significance_threshold`
 * in api/data.py (the API exposes no per-change flag): a change is significant
 * when |activeWeightDelta| >= 0.01 pp (1 bp) for broad funds, 0.02 pp (2 bp)
 * for concentrated funds. Keep the fund list and numbers in lockstep with the API.
 */
export const BROAD_FUNDS = new Set(["AVUV", "AVLV", "AVMV", "AVEM", "AVDV", "AVDE", "AVUS", "AVSC", "AVES", "AVIV"]);
const BROAD_THRESHOLD = 0.01;
const CONCENTRATED_THRESHOLD = 0.02;

export const significanceThreshold = (fund: string): number => (BROAD_FUNDS.has(fund) ? BROAD_THRESHOLD : CONCENTRATED_THRESHOLD);

// Active weights are rounded to 4 decimals by the API; tolerate float noise at the boundary.
// A null delta (catch-up fund, API #144) is never significant.
export const isSignificant = (fund: string, activeWeightDelta: number | null | undefined): boolean =>
  activeWeightDelta != null && Math.abs(activeWeightDelta) >= significanceThreshold(fund) - 1e-9;

/** Split rows into significant moves and "smaller adjustments". Order is preserved. */
export function partitionSignificant<T extends { fund: string; activeWeightDelta: number | null }>(
  rows: T[],
): { significant: T[]; minor: T[] } {
  const significant: T[] = [];
  const minor: T[] = [];
  for (const r of rows) (isSignificant(r.fund, r.activeWeightDelta) ? significant : minor).push(r);
  return { significant, minor };
}
