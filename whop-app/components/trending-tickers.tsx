import Link from "next/link";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { ApiSignal } from "@/lib/api";
import { pct } from "@/lib/format";

export function TrendingTickers({
  signals,
  experienceId,
}: {
  signals: ApiSignal[];
  experienceId: string;
}) {
  if (signals.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
        Trending today
      </h3>
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
        {signals.map((s) => {
          const href = `/experiences/${experienceId}/ticker/${encodeURIComponent(s.ticker)}`;
          const Icon =
            s.direction === "buying" ? ArrowUpRight : ArrowDownRight;
          const iconColor =
            s.direction === "buying"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-rose-700 dark:text-rose-300";

          return (
            <Link
              key={s.ticker}
              href={href}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 hover:border-primary/40 px-3 py-1.5 text-xs whitespace-nowrap transition-colors"
            >
              <span className="font-mono font-semibold">{s.ticker}</span>
              <Icon className={`size-3 ${iconColor}`} />
              <span className="text-muted-foreground">
                {pct(s.totalWeightDelta)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}