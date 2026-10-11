import { useQuery } from "@tanstack/react-query";
import { fundExtras, ROTATION_FUNDS, type ChangePeriod } from "./fundExtras";

const STALE_MS = 5 * 60 * 1000;

/** `enabled` keeps each tab's data from loading until that tab is opened. */
export const useIncomeFund = (fund: string, enabled: boolean) =>
  useQuery({ queryKey: ["income", fund], queryFn: ({ signal }) => fundExtras.income(fund, signal), staleTime: STALE_MS, enabled });

export const useFundChanges = (fund: string, period: ChangePeriod, enabled: boolean) =>
  useQuery({ queryKey: ["fund-changes", fund, period], queryFn: ({ signal }) => fundExtras.changes(fund, period, signal), staleTime: STALE_MS, enabled });

export const useEffectiveness = (fund: string, enabled: boolean) =>
  useQuery({ queryKey: ["effectiveness", fund], queryFn: ({ signal }) => fundExtras.effectiveness(fund, signal), staleTime: STALE_MS, enabled });

export const usePeers = (enabled: boolean) =>
  useQuery({ queryKey: ["effectiveness-peers"], queryFn: ({ signal }) => fundExtras.peers(signal), staleTime: STALE_MS, enabled });

export const useRotation = (fund: string, enabled: boolean) =>
  useQuery({
    queryKey: ["rotation", fund],
    queryFn: ({ signal }) => fundExtras.rotation(fund, signal),
    staleTime: STALE_MS,
    enabled: enabled && ROTATION_FUNDS.has(fund.toUpperCase()),
  });
