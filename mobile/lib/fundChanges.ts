/** Entrances, exits and resizes over a Daily / Weekly / Monthly window (website: ActiveEquityBody). */
import type { Change } from "./types";

/** Active weight, else raw weight, else unknown. null (a catch-up fund) is NEVER treated as zero. */
export const deltaOf = (c: Change): number | null => c.activeWeightDelta ?? c.weightDelta ?? null;

export interface PeriodChanges {
  entrances: Change[];
  exits: Change[];
  increased: Change[];
  trimmed: Change[];
  /** Rows with no known delta (e.g. catch-up): counted, never ranked. */
  unknown: number;
}

export function splitPeriod(changes: Change[]): PeriodChanges {
  const eq = changes.filter((c) => !c.isOption);
  const entrances = eq.filter((c) => c.type === "NEW");
  const exits = eq.filter((c) => c.type === "REMOVED");
  const changed = eq.filter((c) => c.type === "CHANGED");
  const withDelta = changed.map((c) => ({ c, d: deltaOf(c) })).filter((x): x is { c: Change; d: number } => x.d !== null);
  return {
    entrances,
    exits,
    increased: withDelta.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).map((x) => x.c),
    trimmed: withDelta.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).map((x) => x.c),
    unknown: changed.length - withDelta.length,
  };
}

export const PERIOD_LABEL = { daily: "Daily", weekly: "Past 7 days", monthly: "Past 30 days" } as const;
