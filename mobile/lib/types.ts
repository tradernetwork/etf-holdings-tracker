/**
 * Response shapes for the endpoints the app uses.
 *
 * The API's OpenAPI document types these routes' bodies as plain objects (the
 * FastAPI handlers return dicts), so generated types only give us the *paths*
 * and query params (see api-types.ts). Bodies are described here, by hand, and
 * kept deliberately narrow: only fields the UI reads.
 */
export type Direction = "buying" | "selling";

export interface Signal {
  ticker: string;
  name: string;
  sector: string;
  direction: Direction;
  /** Active-weight change in percentage points (summed across funds). */
  weightDelta: number;
  convictionScore: number;
  funds: string[];
  fundCount: number;
  providerCount: number;
}

export interface SignalsResponse {
  asOfDate: string;
  category: string | null;
  signals: { buying: Signal[]; selling: Signal[] };
}

export interface FundSummary {
  fund: string;
  provider: string;
  category: "active-equity" | "option-income";
  aum: number;
  lastHoldingsDate: string;
  stale: boolean;
}

export interface FundsResponse {
  asOfDate: string;
  category: string | null;
  funds: FundSummary[];
}
