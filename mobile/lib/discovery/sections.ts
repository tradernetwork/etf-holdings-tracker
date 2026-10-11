import type { Change } from "../types";
import type { FundMap } from "./types";
import { aggregateChanges } from "./derive";
export type ChangeItem = {
  id: string;
  row?: Change;
  aggregate?: ReturnType<typeof aggregateChanges>[number];
};
export type ChangeSection = { title: string; data: ChangeItem[] };
export function changeSections(
  rows: Change[],
  funds: FundMap,
  grouped: boolean,
  byTicker: boolean,
  expanded: string | null,
): ChangeSection[] {
  if (!rows.length) return [];
  if (byTicker)
    return aggregateChanges(rows, funds).map((aggregate) => ({
      title: aggregate.ticker,
      data: [
        { id: `summary:${aggregate.ticker}`, aggregate },
        ...(expanded === aggregate.ticker
          ? aggregate.rows.map((row) => ({
              id: `${row.fund}:${row.ticker}:${row.type}`,
              row,
            }))
          : []),
      ],
    }));
  const items = (group: Change[]) =>
    group.map((row) => ({ id: `${row.fund}:${row.ticker}:${row.type}`, row }));
  if (!grouped) return [{ title: "Changes", data: items(rows) }];
  const groups = new Map<string, Change[]>();
  for (const row of rows) {
    const provider = funds.get(row.fund)?.provider ?? row.fund;
    let group = groups.get(provider);
    if (!group) {
      group = [];
      groups.set(provider, group);
    }
    group.push(row);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, group]) => ({ title, data: items(group) }));
}
