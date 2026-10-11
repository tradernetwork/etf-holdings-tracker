import type { ChangesResponse } from "./types";
import type { FundSummary } from "../types";
/** Split capped responses via existing filters. Sequential requests avoid a 60/minute API stampede. */
export async function completeChanges(
  first: ChangesResponse,
  funds: FundSummary[],
  load: (filter: {
    provider?: string;
    fund?: string;
  }) => Promise<ChangesResponse>,
): Promise<ChangesResponse> {
  if (first.count < 5000) return { ...first, truncated: false };
  if (!funds.length) return { ...first, truncated: true };
  const responses: ChangesResponse[] = [first];
  let truncated = false;
  const groups = new Map<string, string[]>();
  for (const f of funds)
    groups.set(f.provider, [...(groups.get(f.provider) ?? []), f.fund]);
  const take = async (filter: { provider?: string; fund?: string }) => {
    const response = await load(filter);
    if (response.asOfDate !== first.asOfDate)
      throw new Error(
        "Snapshot changed while loading. Refresh to compare one trading day.",
      );
    return response;
  };
  for (const [provider, group] of groups) {
    if (provider === "Other") {
      for (const fund of group) {
        const individual = await take({ fund });
        responses.push(individual);
        truncated ||= individual.count >= 5000;
      }
      continue;
    }
    const response = await take({ provider });
    if (response.count < 5000) responses.push(response);
    else
      for (const fund of group) {
        const individual = await take({ fund });
        responses.push(individual);
        truncated ||= individual.count >= 5000;
      }
  }
  const knownFunds = new Set(funds.map((f) => f.fund));
  for (const fund of new Set(
    first.changes.map((r) => r.fund).filter((f) => !knownFunds.has(f)),
  )) {
    const response = await take({ fund });
    responses.push(response);
    truncated ||= response.count >= 5000;
  }
  const map = new Map(
    responses
      .flatMap((r) => r.changes)
      .map((r) => [`${r.fund}:${r.ticker}:${r.type}`, r]),
  );
  const changes = [...map.values()];
  return {
    asOfDate: first.asOfDate,
    count: changes.length,
    changes,
    truncated,
  };
}
