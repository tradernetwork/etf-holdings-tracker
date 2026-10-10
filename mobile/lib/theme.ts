/**
 * Design tokens, from the app design spec (Ling Fin visual language).
 * Colour is always paired with a sign or a word, never the only signal.
 */
export const colors = {
  canvas: "#080D18",
  card: "#0D1321",
  cardAlt: "#111A2E",
  border: "#1C2540",

  textPrimary: "#F1F5FF",
  textSecondary: "#A3AECB",
  textMuted: "#7A86A8",

  buy: "#00E676",
  sell: "#FF3D5A",
  isNew: "#FFB800",
  accent: "#4C8DFF",
  stale: "#7A86A8",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 6, md: 10, card: 14, pill: 999 } as const;
/** Minimum touch target (dp). Android guideline is 48; 44 is our floor. */
export const MIN_TAP = 44;

/** Font family names as registered by expo-font in app/_layout.tsx. */
export const fonts = {
  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
  body: "SpaceGrotesk_400Regular",
  bodyMedium: "SpaceGrotesk_500Medium",
  bodyBold: "SpaceGrotesk_700Bold",
} as const;

/** Colour for a signed delta: green up, red down, muted at exactly zero. */
export const deltaColor = (v: number): string => (v > 0 ? colors.buy : v < 0 ? colors.sell : colors.textMuted);
