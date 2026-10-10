/**
 * Followed tickers and funds: pure list operations plus (de)serialisation for
 * AsyncStorage. No React, so it is unit tested directly. The cap matches the
 * planned notifications API (PUT /notifications/follows accepts up to 100).
 */
export type FollowKind = "ticker" | "fund";
export interface Follow {
  kind: FollowKind;
  symbol: string;
}

export const MAX_FOLLOWS = 100;
const SYMBOL = /^[A-Z0-9][A-Z0-9.\-]{0,15}$/;

export const normalizeSymbol = (s: string): string => s.trim().toUpperCase();
export const isValidFollow = (f: Follow): boolean =>
  (f.kind === "ticker" || f.kind === "fund") && SYMBOL.test(f.symbol);

export const isFollowing = (list: Follow[], kind: FollowKind, symbol: string): boolean => {
  const s = normalizeSymbol(symbol);
  return list.some((f) => f.kind === kind && f.symbol === s);
};

export interface ToggleResult {
  list: Follow[];
  /** True only when this call added a follow. */
  added: boolean;
  /** True when adding was refused because the list is full. */
  limitReached: boolean;
}

/** Follow if absent, unfollow if present. The newest follow goes first. */
export function toggleFollow(list: Follow[], kind: FollowKind, symbol: string): ToggleResult {
  const s = normalizeSymbol(symbol);
  const follow: Follow = { kind, symbol: s };
  if (!isValidFollow(follow)) return { list, added: false, limitReached: false };
  if (isFollowing(list, kind, s)) {
    return { list: list.filter((f) => !(f.kind === kind && f.symbol === s)), added: false, limitReached: false };
  }
  if (list.length >= MAX_FOLLOWS) return { list, added: false, limitReached: true };
  return { list: [follow, ...list], added: true, limitReached: false };
}

export const serializeFollows = (list: Follow[]): string => JSON.stringify(list);

/** Tolerant parse: anything malformed in storage yields a clean (possibly empty) list, never a crash. */
export function parseFollows(raw: string | null | undefined): Follow[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: Follow[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const { kind, symbol } = item as Record<string, unknown>;
      if (typeof symbol !== "string" || (kind !== "ticker" && kind !== "fund")) continue;
      const f: Follow = { kind, symbol: normalizeSymbol(symbol) };
      if (isValidFollow(f) && !isFollowing(out, f.kind, f.symbol)) out.push(f);
      if (out.length >= MAX_FOLLOWS) break;
    }
    return out;
  } catch {
    return [];
  }
}
