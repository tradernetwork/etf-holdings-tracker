import { router } from "expo-router";
import { FundOptionBookCard } from "@/components/options/StructureViews";
import { ViewAll } from "@/components/options/parts";
import { Card, Hint, Loading, Note, SectionHeader } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useOptionStructures } from "@/lib/options/queries";

const FUNDS_SHOWN = 2;

/**
 * Ticker screen "Options" section: how the tracked funds' option legs on THIS stock are structured
 * (/api/v1/options/{symbol} only — synthetics, spreads, collars, rolls and their legs). Which funds hold
 * options on the stock as plain positions is the holder list's job, not this section's.
 * Renders nothing when no tracked fund has options on the symbol.
 */
export function TickerOptions({ symbol }: { symbol: string }) {
  const q = useOptionStructures(symbol);
  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.status === 404) return null;
  if (q.isError || !q.data) return <Card><Note>Couldn't load option structures for {symbol}.</Note></Card>;
  const d = q.data;
  if (d.funds.length === 0) return null;
  const shown = d.funds.slice(0, FUNDS_SHOWN);
  return (
    <>
      <SectionHeader
        title="Options"
        right={<ViewAll label={`View all ${d.fundCount} ${d.fundCount === 1 ? "fund" : "funds"}`} onPress={() => router.push(`/options/${encodeURIComponent(symbol)}`)} />}
      />
      <Hint>
        {d.legCount} open {d.legCount === 1 ? "leg" : "legs"} across {d.fundCount} {d.fundCount === 1 ? "fund" : "funds"}
        {d.pairedPct != null ? ` · ${Math.round(d.pairedPct)}% of ${d.tradedLegs} traded legs are paired` : ""} · as of {d.asOfDate}
      </Hint>
      {shown.map((b) => <FundOptionBookCard key={b.fund} book={b} underlying={d.underlying} compact />)}
      {d.funds.length > FUNDS_SHOWN && <Hint>+{d.funds.length - FUNDS_SHOWN} more {d.funds.length - FUNDS_SHOWN === 1 ? "fund" : "funds"} in View all</Hint>}
    </>
  );
}
