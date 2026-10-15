import type { Category, CategoryChoice, Change } from "../types";
import type { FundMap } from "./types";
export const CATEGORY_KEY = "tt.category";
export const CATEGORY_OPTIONS: { value: CategoryChoice; label: string }[] = [
  { value: "active-equity", label: "Active Equity" },
  { value: "option-income", label: "Option-Income" },
  { value: "all", label: "All" },
];
export function parseCategory(raw: string | null | undefined): CategoryChoice {
  return raw === "active-equity" || raw === "option-income" || raw === "all"
    ? raw
    : "active-equity";
}
/**
 * Mirrors `_OPTION_INCOME_FUNDS` / `_ACTIVE_EQUITY_FUNDS` in api/data.py (keep in lockstep). The API's per-row
 * category is authoritative; these per-fund overrides only win over a stale or provider-level value so a covered-call
 * overlay (DIVO, QDVO, IDVO) can never sit under Active Equity, and the Roundhill stock-pickers (DRAM, CHAT) never
 * under Option-Income.
 */
export const OPTION_INCOME_FUNDS: ReadonlySet<string> = new Set(["DIVO", "QDVO", "IDVO"]);
export const ACTIVE_EQUITY_FUNDS: ReadonlySet<string> = new Set(["DRAM", "CHAT"]);

export function effectiveCategory(fund: string, apiCategory: Category | undefined): Category | undefined {
  if (ACTIVE_EQUITY_FUNDS.has(fund)) return "active-equity";
  if (OPTION_INCOME_FUNDS.has(fund)) return "option-income";
  return apiCategory;
}

export function scopeChanges(
  rows: Change[],
  category: CategoryChoice,
  funds?: FundMap,
): Change[] {
  return rows.filter(
    (r) =>
      category === "all" ||
      effectiveCategory(r.fund, funds?.get(r.fund)?.category ?? r.fundCategory) === category,
  );
}
export function scopeLabel(category: CategoryChoice, count: number): string {
  return `${count} ${category === "all" ? "funds (all categories)" : `${category} fund${count === 1 ? "" : "s"}`}`;
}
