/**
 * Design tokens. Two complete palettes so the user can choose from real screens:
 *  - terminal: dark navy, Ling Fin's look (default)
 *  - paper:    warm light paper with dark "evidence" cards, Codex's look
 * Every colour in the UI comes from the active Palette (see theme-context.tsx);
 * nothing imports raw hex. Colour is always paired with a sign or a word.
 */
export type ThemeName = "terminal" | "paper";

export interface Palette {
  name: ThemeName;
  statusBar: "light" | "dark";
  canvas: string;
  card: string;
  border: string;
  tabBar: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  buy: string;
  sell: string;
  /** NEW-position gold / amber. */
  isNew: string;
  accent: string;
  /** Text colour on a solid accent button. */
  onAccent: string;
  stale: string;
  /** Dark "evidence" hero card (always dark, in both themes). */
  heroBg: string;
  heroBorder: string;
  heroText: string;
  heroMuted: string;
  heroBuy: string;
  heroSell: string;
  heroChip: string;
  /** Amber older-disclosure banner. */
  warnBg: string;
  warnBorder: string;
  warnText: string;
  overlay: string;
}

export const terminal: Palette = {
  name: "terminal",
  statusBar: "light",
  canvas: "#080D18",
  card: "#0D1321",
  border: "#1C2540",
  tabBar: "#0D1321",
  textPrimary: "#F1F5FF",
  textSecondary: "#A3AECB",
  textMuted: "#7A86A8",
  buy: "#00E676",
  sell: "#FF3D5A",
  isNew: "#FFB800",
  accent: "#4C8DFF",
  onAccent: "#04122B",
  stale: "#7A86A8",
  heroBg: "#111A2E",
  heroBorder: "#26325A",
  heroText: "#F1F5FF",
  heroMuted: "#8F9BC0",
  heroBuy: "#00E676",
  heroSell: "#FF6B80",
  heroChip: "#1C2540",
  warnBg: "#2A2108",
  warnBorder: "#5C4710",
  warnText: "#FFB800",
  overlay: "rgba(0,0,0,0.55)",
};

export const paper: Palette = {
  name: "paper",
  statusBar: "dark",
  canvas: "#F6F5EF",
  card: "#FFFFFF",
  border: "#DCE1D8",
  tabBar: "#F6F5EF",
  textPrimary: "#182423",
  textSecondary: "#4A5A56",
  textMuted: "#71807B",
  buy: "#087C65",
  sell: "#BA5346",
  isNew: "#926516",
  accent: "#087C65",
  onAccent: "#FFFFFF",
  stale: "#71807B",
  heroBg: "#142A28",
  heroBorder: "#1F3D3A",
  heroText: "#FFFFFF",
  heroMuted: "#9DB5AE",
  heroBuy: "#8FDDB9",
  heroSell: "#F4B4A4",
  heroChip: "#1F3D3A",
  warnBg: "#F5EAD0",
  warnBorder: "#E3D1A1",
  warnText: "#926516",
  overlay: "rgba(24,36,35,0.45)",
};

export const palettes: Record<ThemeName, Palette> = { terminal, paper };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 6, md: 10, card: 14, hero: 22, pill: 999 } as const;
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

/** Editorial headline type: heavy and tightly tracked. Used for ticker/fund symbols. */
export const display = {
  fontFamily: fonts.bodyBold,
  letterSpacing: -1.5,
} as const;

/** Colour for a signed delta: up, down, or muted at exactly zero. */
export const deltaColor = (v: number | null | undefined, c: Palette): string => (v != null && v > 0 ? c.buy : v != null && v < 0 ? c.sell : c.textMuted);
