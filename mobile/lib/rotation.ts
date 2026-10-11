/** Theme/sector rotation report for ULTI and ULTY (website: components/rotation-panel.tsx). */
import type { RotationData } from "./fundExtras";

export const ROTATION_PALETTE = [
  "#f7931a", "#00d4ff", "#a78bfa", "#34d399", "#60a5fa", "#f472b6", "#fbbf24",
  "#22d3ee", "#c084fc", "#4ade80", "#fb7185", "#38bdf8", "#e879f9", "#facc15",
];

/** Groups by current weight, biggest first; "Uncategorized" always last. */
export function sortedGroups(d: RotationData): string[] {
  return [...d.themes].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return (d.currentThemes[b] || 0) - (d.currentThemes[a] || 0);
  });
}

/** Stable colour by sorted index; an unmapped name reads as grey, not as a real group. */
export function groupColor(group: string, sorted: string[]): string {
  if (group === "Uncategorized") return "#64748b";
  const i = sorted.indexOf(group);
  return ROTATION_PALETTE[(i < 0 ? 0 : i) % ROTATION_PALETTE.length];
}

/** Hex colour with an alpha channel (0..1). */
export function hexAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0")}`;
}

export const maxCell = (d: RotationData): number => Math.max(1, ...d.timeline.flatMap((t) => Object.values(t.weights)));

export const rotationTitle = (d: RotationData): string => `${d.groupBy.charAt(0).toUpperCase()}${d.groupBy.slice(1)} rotation`;

/** Groups currently held, with their weight. */
export const currentBars = (d: RotationData): { group: string; weight: number }[] =>
  sortedGroups(d).map((g) => ({ group: g, weight: d.currentThemes[g] || 0 })).filter((x) => x.weight > 0);

/** The API's churn `rate` is a 0..1 fraction (ULTI 0.62), the website prints round(rate * 100) = "62%". */
export const churnPercent = (rate: number): number => Math.round(Math.min(1, Math.max(0, rate)) * 100);

/** Weekly-drift cells print their weight only from 5% up (the website's rule); smaller ones stay tappable. */
export const cellLabel = (w: number): string => (w >= 5 ? w.toFixed(0) : "");

/** "Bitcoin miners · 2026-07-21: 5.5%" - the website's tooltip, which is a tap detail here. */
export const cellDetail = (group: string, date: string, w: number): string => `${group} · ${date}: ${w.toFixed(1)}%`;
