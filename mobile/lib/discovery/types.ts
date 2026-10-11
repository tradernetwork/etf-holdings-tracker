import type { Change, TickerResponse, FundSummary } from "../types";
export type Period = "daily" | "weekly" | "monthly";
export type Horizon = "all" | Period;
export type Direction = "all" | "buying" | "selling";
export type MoveType = "all" | "NEW" | "EXIT" | "ADD" | "TRIM";
export interface ChangesResponse {
  asOfDate: string;
  count: number;
  changes: Change[];
  truncated?: boolean;
}
export interface ActivityResponse {
  accumulating: Change[];
  reducing: Change[];
  optionsActivity: Change[];
}
export interface StockRow {
  ticker: string;
  name: string;
  sector: string;
  fundCount: number;
  funds: string[];
  totalWeight: number;
  netChange: number;
  newEntryFunds: string[];
  exitFunds?: string[];
  streak?: number | null;
  distinctProviders?: number;
}
export interface StocksResponse {
  asOfDate: string;
  count: number;
  tickers: StockRow[];
}
export type StockSort = "funds" | "weight" | "change" | "streak";
export type StockSignal =
  | "all"
  | "buying"
  | "selling"
  | "streak"
  | "new"
  | "exit"
  | "crossfam";
export interface HistoryPoint {
  date: string;
  blendedWeight: number;
  fundCount: number;
}
export type TrendSignal =
  | "accumulating"
  | "distribution-starting"
  | "distributing"
  | "bottoming";
export interface TrendRow {
  ticker: string;
  name: string;
  sector: string;
  blendedWeight: number;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  fundCount: number;
  signal: TrendSignal;
}
export interface TrendResponse {
  asOfDate: string;
  fundCount: number;
  tickers: TrendRow[];
}
export interface StockResponse extends TickerResponse {
  history: HistoryPoint[];
  institutional: Omit<TrendRow, "ticker" | "name" | "sector"> & {
    streak: number | null;
    estimatedExposureM?: number | null;
  };
}
export type ChangeSort = "delta" | "ticker" | "name" | "fund" | "type";
export interface ChangeFilters {
  sort?: ChangeSort;
  ascending?: boolean;
  fund: string;
  provider: string;
  sector: string;
  type: MoveType;
  direction: Direction;
  search: string;
}
export interface StockFilters {
  provider: string;
  sector: string;
  signal: StockSignal;
  search: string;
  sort: StockSort;
}
export type FundMap = Map<string, FundSummary>;
export interface MatrixRow {
  ticker: string;
  cells: Map<string, Change>;
  magnitude: number;
}
export interface InstitutionalEntry {
  ticker: string;
  name: string;
  sector: string;
  blendedWeight: number;
  previousBlendedWeight: number;
  weightDelta: number | null;
  fundCount: number;
  funds: string[];
  direction: "buying" | "selling";
}
export interface InstitutionalResponse {
  asOfDate: string;
  period: Period;
  fundCount: number;
  totalAum: number;
  buying: InstitutionalEntry[];
  selling: InstitutionalEntry[];
}
