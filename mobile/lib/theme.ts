/**
 * Design tokens. Same flat-object shape as vero's lib/theme.ts, with values
 * mirrored from the dashboard (etf-dashboard/app/globals.css) so web and app
 * read as one product. Dark only for now.
 */
export const colors = {
  canvas: "#0a0f1e",
  surface: "#111827",
  surfaceAlt: "#0f172a",
  surfaceElevated: "#1e293b",
  rule: "#1f2937",
  ruleStrong: "#334155",

  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",

  equity: "#00d4ff",
  income: "#fbbf24",
  warning: "#f59e0b",
  buy: "#00ff88",
  sell: "#ff4444",
  meta: "#a78bfa",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 6, md: 10, lg: 14, pill: 999 } as const;
/** Minimum touch target (dp). Android guideline is 48; 44 is our floor. */
export const MIN_TAP = 44;

export const fonts = {
  // System fonts for now; swap for bundled fonts when the design lands.
  mono: "monospace",
} as const;
