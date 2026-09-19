import { type ApiSignalPerformance, type ApiPerformanceAggregate } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target } from "lucide-react";
import { pct, pctUnsigned } from "@/lib/format";

export function TrackRecordCard({ performance }: { performance: ApiSignalPerformance | null }) {
  if (!performance || performance.withReturns === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Not enough priced history yet to show a track record.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Target className="size-4 text-primary" />
        <CardTitle className="text-base">Signal track record</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Over the last {performance.lookbackDays} days
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatBlock
            label="Buy signals"
            tone="buying"
            aggregate={performance.overall.buying}
          />
          <StatBlock
            label="Sell signals"
            tone="selling"
            aggregate={performance.overall.selling}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          This reflects historical price movement after each signal (not a prediction), and isn&apos;t investment advice.
        </p>
      </CardContent>
    </Card>
  );
}

function StatBlock({
  label,
  tone,
  aggregate,
}: {
  label: string;
  tone: "buying" | "selling";
  aggregate: ApiPerformanceAggregate;
}) {
  const textTone =
    tone === "buying"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-rose-700 dark:text-rose-300";

  if (aggregate.n === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">not enough data yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-semibold ${textTone}`}>
          {pctUnsigned(aggregate.winRate * 100)}
        </span>
        <span className="text-xs text-muted-foreground">win rate</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-sm font-medium ${textTone}`}>
          {pct(aggregate.medianReturn * 100)}
        </span>
        <span className="text-xs text-muted-foreground">median return</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        based on {aggregate.n} signal{aggregate.n === 1 ? "" : "s"}
      </p>
    </div>
  );
}