/**
 * Which way a position was traded: the API's `direction` field, which follows
 * the split-adjusted share count (api/data.py `change_direction`). A fund whose
 * share count rose is never a TRIM and one whose count fell is never an ADD,
 * whatever the renormalized active weight rounds to. Older payloads without the
 * field fall back to the sign of the (guarded) active delta, then raw.
 */
export type TradeDirection = 'buying' | 'selling' | 'unchanged';

export function changeDirection(c: {
    direction?: string | null;
    activeWeightDelta?: number | null;
    weightDelta?: number | null;
    type?: string;
}): TradeDirection {
    if (c.direction === 'buying' || c.direction === 'selling' || c.direction === 'unchanged') return c.direction;
    if (c.type === 'NEW') return 'buying';
    if (c.type === 'REMOVED') return 'selling';
    const d = c.activeWeightDelta ?? c.weightDelta ?? 0;
    return d > 0 ? 'buying' : d < 0 ? 'selling' : 'unchanged';
}
