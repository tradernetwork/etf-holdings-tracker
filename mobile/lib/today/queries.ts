import { useQuery } from "@tanstack/react-query";
import { todayApi } from "./api";

const STALE_MS = 5 * 60 * 1000;

export const useTodayFull = (category: string | undefined) =>
  useQuery({ queryKey: ["today-full", category ?? "all"], queryFn: ({ signal }) => todayApi.full(category, signal), staleTime: STALE_MS });

export const useLayeringFull = (windowDays: number, minFunds: number) =>
  useQuery({
    queryKey: ["layering-full", windowDays, minFunds],
    queryFn: ({ signal }) => todayApi.layering({ windowDays, minFunds, limit: 100 }, signal),
    staleTime: STALE_MS,
  });
