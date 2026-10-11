/**
 * Honest expiry labels. The API's `dte` and every position row are as of a snapshot (file) date, which is
 * often older than today: a leg that "Expires today" in the Oct 9 file has expired by Oct 11. These
 * helpers count from the device's current date and keep the file's own DTE as a note for transparency.
 * `now` is injectable so tests run on a fixed clock.
 */
import { daysBetween, formatExpiry } from "./book";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The device's calendar date as YYYY-MM-DD (local time, not UTC: the user's "today"). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "Oct 9" from an ISO date; "" when unparseable. */
export function shortDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : "";
}

export interface ExpiryInfo {
  /** "Expired Oct 9" / "Expires today" / "2 DTE" / "" when nothing is known. */
  label: string;
  expired: boolean;
  /** Days from today to expiry (negative once past); null when the expiry is unknown. */
  daysLeft: number | null;
  /** The file's own DTE, kept visible when it differs from today's count: "File: 0 DTE as of Oct 9". */
  fileNote: string | null;
}

const dteText = (n: number): string => (n === 0 ? "0 DTE" : `${n} DTE`);

export function expiryInfo(input: { expiry?: string | null; asOf?: string | null; fileDte?: number | null; now?: Date }): ExpiryInfo {
  const today = todayIso(input.now);
  const fileDte = input.fileDte == null || Number.isNaN(input.fileDte) ? null : Math.round(input.fileDte);
  const left = daysBetween(today, input.expiry);
  const stale = !!input.asOf && input.asOf < today;
  const asOfDay = shortDay(input.asOf);
  if (left === null) {
    // No expiry date to count from: all we have is the file's number, so say so.
    return { label: fileDte === null ? "" : `${dteText(fileDte)}${asOfDay ? ` (as of ${asOfDay} file)` : ""}`, expired: false, daysLeft: null, fileNote: null };
  }
  const label = left < 0 ? `Expired ${shortDay(input.expiry)}` : left === 0 ? "Expires today" : dteText(left);
  const differs = fileDte !== null && fileDte !== left;
  const fileNote = stale && differs && asOfDay ? `File: ${dteText(fileDte as number)} as of ${asOfDay}` : null;
  return { label, expired: left < 0, daysLeft: left, fileNote };
}

/** "11/20/26 · 42 DTE" with the honest label; FLEX appended. */
export function expirySubtitle(info: ExpiryInfo, expiry: string | null | undefined, isFlex: boolean | null | undefined): string {
  // An expired label already names the date, so the MM/DD/YY would repeat it.
  return [info.expired ? "" : formatExpiry(expiry), info.label, isFlex ? "FLEX" : ""].filter(Boolean).join(" · ");
}

/** A file DTE shifted to today: days left, floored at 0; null when it has already expired. */
export function dteToday(fileDte: number | null | undefined, asOf: string | null | undefined, now?: Date): number | null {
  if (fileDte == null || Number.isNaN(fileDte)) return null;
  const age = asOf ? daysBetween(asOf, todayIso(now)) : 0;
  const left = Math.round(fileDte) - Math.max(age ?? 0, 0);
  return left < 0 ? null : left;
}
