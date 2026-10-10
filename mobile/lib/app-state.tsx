import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CategoryChoice } from "./types";

interface AppState {
  category: CategoryChoice;
  setCategory: (c: CategoryChoice) => void;
  /** Followed tickers. In memory only for now (no persistence, no push yet). */
  follows: string[];
  isFollowing: (symbol: string) => boolean;
  toggleFollow: (symbol: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Spec: the default view is Active Equity.
  const [category, setCategory] = useState<CategoryChoice>("active-equity");
  const [follows, setFollows] = useState<string[]>([]);
  const isFollowing = useCallback((s: string) => follows.includes(s), [follows]);
  const toggleFollow = useCallback(
    (s: string) => setFollows((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s])),
    [],
  );
  const value = useMemo(
    () => ({ category, setCategory, follows, isFollowing, toggleFollow }),
    [category, follows, isFollowing, toggleFollow],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside AppStateProvider");
  return v;
}
