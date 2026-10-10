import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { palettes, type Palette, type ThemeName } from "./theme";

const STORAGE_KEY = "tt.theme";

interface ThemeState {
  palette: Palette;
  themeName: ThemeName;
  setThemeName: (n: ThemeName) => void;
}

const Ctx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setName] = useState<ThemeName>("terminal");

  // The choice is remembered across launches; a storage failure just means the default.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === "terminal" || v === "paper") setName(v);
      })
      .catch(() => {});
  }, []);

  const setThemeName = useCallback((n: ThemeName) => {
    setName(n);
    AsyncStorage.setItem(STORAGE_KEY, n).catch(() => {});
  }, []);

  const value = useMemo(() => ({ palette: palettes[themeName], themeName, setThemeName }), [themeName, setThemeName]);
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
  const { themeName, setThemeName } = useThemeState();
  return { themeName, setThemeName };
};

/** Memoised StyleSheet for the active palette. `make` must be a module-level function. */
export function useStyles<T>(make: (c: Palette) => T): T {
  const c = useTheme();
  return useMemo(() => make(c), [make, c]);
}
