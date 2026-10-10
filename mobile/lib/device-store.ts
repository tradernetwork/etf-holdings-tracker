/**
 * Where the device registration lives. The bearer secret goes in the OS keystore
 * (expo-secure-store), never AsyncStorage. Web has no secure storage and never
 * registers, so its store is permanently empty.
 */
import { Platform } from "react-native";

export interface StoredDevice {
  deviceId: string;
  secret: string;
  /** The push token this registration was made with (to spot token rotation). */
  token: string;
}

export interface DeviceStore {
  get(): Promise<StoredDevice | null>;
  set(d: StoredDevice): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "tt.device";

export function parseStoredDevice(raw: string | null | undefined): StoredDevice | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredDevice>;
    return typeof v.deviceId === "string" && typeof v.secret === "string" && typeof v.token === "string"
      ? { deviceId: v.deviceId, secret: v.secret, token: v.token }
      : null;
  } catch {
    return null;
  }
}

export const webDeviceStore: DeviceStore = {
  get: async () => null,
  set: async () => {},
  clear: async () => {},
};

type SecureStoreModule = Pick<typeof import("expo-secure-store"), "getItemAsync" | "setItemAsync" | "deleteItemAsync">;

/** `load` is injectable so tests can supply a fake keystore; web never loads the native module. */
export function createSecureDeviceStore(load: () => Promise<SecureStoreModule> = () => import("expo-secure-store")): DeviceStore {
  if (Platform.OS === "web") return webDeviceStore;
  return {
    async get() {
      const SS = await load();
      return parseStoredDevice(await SS.getItemAsync(KEY).catch(() => null));
    },
    async set(d) {
      const SS = await load();
      await SS.setItemAsync(KEY, JSON.stringify(d));
    },
    async clear() {
      const SS = await load();
      await SS.deleteItemAsync(KEY).catch(() => {});
    },
  };
}
