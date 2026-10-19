/**
 * "Today" is only true when the data is from today. Everywhere a label would say "today" for the latest file,
 * it asks here: same date as the device -> "today"; older -> the file's date ("Oct 9"). `now` is injectable.
 */
import { shortDay, todayIso } from "./expiry";

export const isToday = (asOf: string | null | undefined, now?: Date): boolean => !!asOf && asOf === todayIso(now);

/** "today" / "Oct 9" / "the latest file" when the date is unknown. */
export function dayWord(asOf: string | null | undefined, now?: Date): string {
  if (!asOf) return "the latest file";
  return isToday(asOf, now) ? "today" : shortDay(asOf) || "the latest file";
}

/** For "...in {fileRef(d)}": "the latest file" / "today's file" / "the Oct 9 file". Never doubles "the" or "file". */
export function fileRef(asOf: string | null | undefined, now?: Date): string {
  if (!asOf) return "the latest file";
  if (isToday(asOf, now)) return "today's file";
  const d = shortDay(asOf);
  return d ? `the ${d} file` : "the latest file";
}

/** "changed today" / "changed in the Oct 9 file" / "changed in the latest file". */
export function inFile(asOf: string | null | undefined, now?: Date): string {
  if (!asOf) return "in the latest file";
  return isToday(asOf, now) ? "today" : `in the ${shortDay(asOf)} file`;
}

/** The newest file date among holdings rows (ticker screen has no top-level as-of). */
export function latestFileDate(rows: { fileDate?: string | null }[]): string | null {
  let best: string | null = null;
  for (const r of rows) if (r.fileDate && (best === null || r.fileDate > best)) best = r.fileDate;
  return best;
}

/** Section/label prefix: "Option activity today" / "Option activity · Oct 9". */
export function activityTitle(asOf: string | null | undefined, now?: Date): string {
  return isToday(asOf, now) ? "Option activity today" : `Option activity · ${dayWord(asOf, now)}`;
}
