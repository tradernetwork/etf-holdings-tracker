import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { isFollowing as isFollowingIn, parseFollows, serializeFollows, toggleFollow as toggleIn, type Follow, type FollowKind } from "./follows";
import { initialOptIn, parseOptIn, reduceOptIn, shouldPrompt, type OptInState } from "./notify";
import { createSecureDeviceStore } from "./device-store";
import { NotifySync } from "./notify-sync";
import { createNotifyApi, NOTIFICATIONS_BACKEND_ENABLED } from "./notifyApi";
import { currentPushToken, requestEnable } from "./notifications";
import type { CategoryChoice } from "./types";

const FOLLOWS_KEY = "tt.follows";
const NOTIFY_KEY = "tt.notify";

interface AppState {
  category: CategoryChoice;
  setCategory: (c: CategoryChoice) => void;
  follows: Follow[];
  /** False until follows have been read from storage (avoids flashing the empty state). */
  hydrated: boolean;
  isFollowing: (kind: FollowKind, symbol: string) => boolean;
  toggleFollow: (kind: FollowKind, symbol: string) => void;
  clearFollows: () => void;
  notify: OptInState;
  /** The one-time "Get a daily digest?" sheet. */
  promptVisible: boolean;
  enableNotifications: () => Promise<void>;
  dismissPrompt: () => void;
  disableNotifications: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Spec: the default view is Active Equity.
  const [category, setCategory] = useState<CategoryChoice>("active-equity");
  const [follows, setFollows] = useState<Follow[]>([]);
  const [notify, setNotify] = useState<OptInState>(initialOptIn);
  const [promptVisible, setPromptVisible] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Server sync for notifications. Inert unless EXPO_PUBLIC_NOTIFICATIONS_BACKEND=1 and not on web.
  const sync = useMemo(
    () => new NotifySync({ api: createNotifyApi(), store: createSecureDeviceStore(), enabled: NOTIFICATIONS_BACKEND_ENABLED, platform: Platform.OS }),
    [],
  );
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const followsRef = useRef(follows);
  followsRef.current = follows;

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(FOLLOWS_KEY), AsyncStorage.getItem(NOTIFY_KEY)])
      .then(([f, n]) => {
        setFollows(parseFollows(f));
        setNotify(parseOptIn(n));
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // On launch, notice a rotated push token and re-subscribe. Never prompts.
  useEffect(() => {
    if (!hydrated || !notifyRef.current.enabled) return;
    void currentPushToken().then((t) => sync.onLaunch(t, followsRef.current));
  }, [hydrated, sync]);

  const saveFollows = useCallback((list: Follow[]) => {
    setFollows(list);
    AsyncStorage.setItem(FOLLOWS_KEY, serializeFollows(list)).catch(() => {});
  }, []);
  const saveNotify = useCallback((s: OptInState) => {
    setNotify(s);
    AsyncStorage.setItem(NOTIFY_KEY, JSON.stringify(s)).catch(() => {});
  }, []);

  const toggleFollow = useCallback(
    (kind: FollowKind, symbol: string) => {
      const r = toggleIn(followsRef.current, kind, symbol);
      if (r.list === followsRef.current) return;
      saveFollows(r.list);
      const n = notifyRef.current;
      sync.onFollowsChanged(r.list, n.enabled ? n.token : null); // debounced PUT of the full list
      // Only a just-ADDED follow can trigger the one-time prompt; never launch, never an unfollow.
      if (shouldPrompt(notifyRef.current, { justAdded: r.added, followCount: r.list.length, platform: Platform.OS })) {
        setPromptVisible(true);
      }
    },
    [saveFollows, sync],
  );

  // Clearing follows also deletes the device server-side and wipes the secret; the next follow re-registers.
  const clearFollows = useCallback(() => {
    saveFollows([]);
    void sync.onDisabled();
  }, [saveFollows, sync]);

  const enableNotifications = useCallback(async () => {
    setPromptVisible(false);
    let next: OptInState;
    try {
      const out = await requestEnable();
      next = reduceOptIn(notifyRef.current, { type: "enable-result", permission: out.permission, token: out.token });
      if (out.token) void sync.onEnabled(out.token, followsRef.current); // no-op while the backend flag is off
    } catch {
      next = reduceOptIn(notifyRef.current, { type: "enable-result", permission: "denied" });
    }
    saveNotify(next);
  }, [saveNotify, sync]);

  const dismissPrompt = useCallback(() => {
    setPromptVisible(false);
    saveNotify(reduceOptIn(notifyRef.current, { type: "not-now" }));
  }, [saveNotify]);

  const disableNotifications = useCallback(() => {
    saveNotify(reduceOptIn(notifyRef.current, { type: "disable" }));
    void sync.onDisabled();
  }, [saveNotify, sync]);

  const isFollowing = useCallback((kind: FollowKind, symbol: string) => isFollowingIn(follows, kind, symbol), [follows]);

  const value = useMemo(
    () => ({
      category, setCategory, follows, hydrated, isFollowing, toggleFollow, clearFollows,
      notify, promptVisible, enableNotifications, dismissPrompt, disableNotifications,
    }),
    [category, follows, hydrated, isFollowing, toggleFollow, clearFollows, notify, promptVisible, enableNotifications, dismissPrompt, disableNotifications],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside AppStateProvider");
  return v;
}
