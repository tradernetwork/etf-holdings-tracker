import { useQuery } from "@tanstack/react-query";
import { todayApi } from "./api";

const STALE_MS = 5 * 60 * 1000;

/** `limit` asks for longer ranked lists; an older server ignores it (see listState). */
export const useTodayFull = (category: string | undefined, limit?: number) =>
  useQuery({ queryKey: ["today-full", category ?? "all", limit ?? 0], queryFn: ({ signal }) => todayApi.full(category, limit, signal), staleTime: STALE_MS });

export const useLayeringFull = (windowDays: number, minFunds: number) =>
  useQuery({
    queryKey: ["layering-full", windowDays, minFunds],
    queryFn: ({ signal }) => todayApi.layering({ windowDays, minFunds, limit: 100 }, signal),
    staleTime: STALE_MS,
  });
