import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pct } from "@/lib/format";
import type { ApiBriefing } from "@/lib/api";

export function DailyBriefCard({
  briefing,
  experienceId,
}: {
  briefing: ApiBriefing;
  experienceId: string;
}) {
  const topBuy = briefing.topBuys[0];
  const topSell = briefing.topSells[0];
  const biggestStreak =
    briefing.activeStreaks.length > 0
      ? briefing.activeStreaks.reduce((a, b) =>
          a.days >= b.days ? a : b,
        )
      : null;

  const hasAny = topBuy || topSell || biggestStreak;

  if (!hasAny) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          Nothing on the tape yet today. Check back after the next scrape.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <CardTitle className="text-base">Today&apos;s brief</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {topBuy ? (
            <Link
              href={`/experiences/${experienceId}/ticker/${encodeURIComponent(topBuy.ticker)}`}
              className="block rounded-md border border-border/60 hover:border-primary/40 hover:bg-card transition-colors p-3"
            >
              <span className="text-xs text-muted-foreground">Top buy</span>
              <div className="flex items-center gap-2 mt-1">
                <ArrowUpRight className="size-4 text-emerald-700 dark:text-emerald-300" />
                <span className="font-mono font-semibold tracking-tight">
                  {topBuy.ticker}
                </span>
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  {pct(topBuy.totalWeightDelta)}
                </span>
              </div>
            </Link>
          ) : (
            <div className="rounded-md border border-border/60 p-3">
              <span className="text-xs text-muted-foreground">Top buy</span>
              <p className="text-xs text-muted-foreground mt-1">
                No standout buy today
              </p>
            </div>
          )}

          {topSell ? (
            <Link
              href={`/experiences/${experienceId}/ticker/${encodeURIComponent(topSell.ticker)}`}
              className="block rounded-md border border-border/60 hover:border-primary/40 hover:bg-card transition-colors p-3"
            >
              <span className="text-xs text-muted-foreground">Top sell</span>
              <div className="flex items-center gap-2 mt-1">
                <ArrowDownRight className="size-4 text-rose-700 dark:text-rose-300" />
                <span className="font-mono font-semibold tracking-tight">
                  {topSell.ticker}
                </span>
                <span className="text-xs text-rose-700 dark:text-rose-300">
                  {pct(topSell.totalWeightDelta)}
                </span>
              </div>
            </Link>
          ) : (
            <div className="rounded-md border border-border/60 p-3">
              <span className="text-xs text-muted-foreground">Top sell</span>
              <p className="text-xs text-muted-foreground mt-1">
                No standout sell today
              </p>
            </div>
          )}

          {biggestStreak ? (
            <Link
              href={`/experiences/${experienceId}/ticker/${encodeURIComponent(biggestStreak.ticker)}`}
              className="block rounded-md border border-border/60 hover:border-primary/40 hover:bg-card transition-colors p-3"
            >
              <span className="text-xs text-muted-foreground">
                Biggest streak
              </span>
              <div className="flex items-center gap-2 mt-1">
                <Flame className="size-4 text-amber-700 dark:text-amber-300" />
                <span className="font-mono font-semibold tracking-tight">
                  {biggestStreak.ticker}
                </span>
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {biggestStreak.days}d
                </span>
                <span className="text-xs text-muted-foreground">
                  {biggestStreak.direction === "up"
                    ? "Accumulation"
                    : "Distribution"}
                </span>
              </div>
            </Link>
          ) : (
            <div className="rounded-md border border-border/60 p-3">
              <span className="text-xs text-muted-foreground">
                Biggest streak
              </span>
              <p className="text-xs text-muted-foreground mt-1">
                No active streaks
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}