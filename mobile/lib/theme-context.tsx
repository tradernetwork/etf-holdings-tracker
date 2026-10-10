import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { DEFAULT_THEME_PREFERENCE, palettes, parseThemePreference, resolveTheme, type Palette, type ThemeName, type ThemePreference } from "./theme";

const STORAGE_KEY = "tt.theme";

interface ThemeState {
  palette: Palette;
  /** The look actually rendered right now (Auto resolved against the phone). */
  themeName: ThemeName;
  /** What the user chose: auto / terminal / paper. */
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** False until the saved preference has been read, so the first frame is already the right look. */
  hydrated: boolean;
}

const Ctx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [hydrated, setHydrated] = useState(false);
  // Live: updates when the phone switches between light and dark (e.g. at sunset). On web this is prefers-color-scheme.
  const scheme = useColorScheme();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => setPref(parseThemePreference(v)))
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const themeName = resolveTheme(preference, scheme);
  const value = useMemo(
    () => ({ palette: palettes[themeName], themeName, preference, setPreference, hydrated }),
    [themeName, preference, setPreference, hydrated],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useThemeState(): ThemeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("theme hooks used outside ThemeProvider");
  return v;
}

/** The active palette. */
export const useTheme = (): Palette => useThemeState().palette;
export const useThemeControls = () => {
  const { themeName, preference, setPreference } = useThemeState();
  return { themeName, preference, setPreference };
};
export const useThemeHydrated = (): boolean => useThemeState().hydrated;

/** Memoised StyleSheet for the active palette. `make` must be a module-level function. */
export function useStyles<T>(make: (c: Palette) => T): T {
  const c = useTheme();
  return useMemo(() => make(c), [make, c]);
}
