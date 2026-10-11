import { useQuery } from "@tanstack/react-query";
import { request } from "../api";
import { loadCompleteChanges, type ChangeQuery } from "./paged-changes";
import type { Category, FundsResponse } from "../types";
import type {
  ChangesResponse,
  ActivityResponse,
  StocksResponse,
  StockResponse,
  TrendResponse,
  InstitutionalResponse,
  Period,
} from "./types";
export const discoveryApi = {
  changes: async (
    period: Period,
    category?: Category,
    signal?: AbortSignal,
  ) => {
    const load = (query: ChangeQuery) =>
      request<ChangesResponse>(
        "/api/v1/changes",
        { period, category, ...query },
        signal,
      );
    return loadCompleteChanges(load, async () => {
      const metadata = await request<FundsResponse>(
        "/api/v1/funds",
        {},
        signal,
      );
      return metadata.funds.filter((f) => !category || f.category === category);
    });
  },
  activity: (period: Period, signal?: AbortSignal) =>
    request<ActivityResponse>("/api/v1/activity", { period }, signal),
  stocks: (sort: "funds" | "weight", signal?: AbortSignal) =>
    request<StocksResponse>("/api/v1/tickers", { sort, limit: 1000 }, signal),
  stock: (symbol: string, signal?: AbortSignal) =>
    request<StockResponse>(
      `/api/v1/stock/${encodeURIComponent(symbol)}` as "/api/v1/stock/{ticker}",
      {},
      signal,
    ),
  trend: (signal?: AbortSignal) =>
    request<TrendResponse>(
      "/api/v1/institutional-trend",
      { limit: 50 },
      signal,
    ),
};
export const useInstitutional = (period: Period) =>
  useQuery({
    staleTime: 5 * 60 * 1000,
    queryKey: ["discovery-institutional", period],
    queryFn: ({ signal }) =>
      request<InstitutionalResponse>(
        "/api/v1/institutional",
        { period, limit: 100 },
        signal,
      ),
  });
const options = { staleTime: 5 * 60 * 1000 };
export const useChanges = (period: Period, category?: Category) =>
  useQuery({
    ...options,
    queryKey: ["discovery-changes", period, category ?? "all"],
    queryFn: ({ signal }) => discoveryApi.changes(period, category, signal),
  });
export const useActivity = (period: Period) =>
  useQuery({
    ...options,
    queryKey: ["discovery-activity", period],
    queryFn: ({ signal }) => discoveryApi.activity(period, signal),
  });
export const useStocks = (sort: "funds" | "weight") =>
  useQuery({
    ...options,
    queryKey: ["discovery-stocks", sort],
    queryFn: ({ signal }) => discoveryApi.stocks(sort, signal),
  });
export const useStock = (symbol: string) =>
  useQuery({
    ...options,
    queryKey: ["discovery-stock", symbol],
    queryFn: ({ signal }) => discoveryApi.stock(symbol, signal),
    enabled: !!symbol,
  });
export const useTrend = () =>
  useQuery({
    ...options,
    queryKey: ["discovery-trend"],
    queryFn: ({ signal }) => discoveryApi.trend(signal),
  });
