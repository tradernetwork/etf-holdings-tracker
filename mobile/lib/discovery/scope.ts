import type { CategoryChoice, Change } from "../types";
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
export function scopeChanges(
  rows: Change[],
  category: CategoryChoice,
  funds?: FundMap,
): Change[] {
  return rows.filter(
    (r) =>
      category === "all" ||
      (funds?.get(r.fund)?.category ?? r.fundCategory) === category,
  );
}
export function scopeLabel(category: CategoryChoice, count: number): string {
  return `${count} ${category === "all" ? "funds (all categories)" : `${category} fund${count === 1 ? "" : "s"}`}`;
}
