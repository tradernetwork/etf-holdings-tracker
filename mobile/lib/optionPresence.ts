/**
 * Does this fund hold any option at all? Funds with none (AVUV, ARKK, and the income funds that are still stock-only such as
 * YMAX) get no option-specific columns, sections or filters. This only hides what would be empty: a fund with a single leg,
 * live or expired, keeps everything.
 */
export function fundHasOptions(
  f: { optionsCount?: number | null; optionHoldings?: unknown[] | null } | undefined | null,
  income?: { positions?: { legs: unknown[] }[] | null; counts?: { optionLegs?: number | null } | null } | undefined | null,
): boolean {
  if (!f) return true; // unknown: show everything rather than hide data
  if ((f.optionsCount ?? 0) > 0 || (f.optionHoldings?.length ?? 0) > 0) return true;
  if ((income?.counts?.optionLegs ?? 0) > 0) return true;
  return !!income?.positions?.some((p) => p.legs.length > 0);
}
