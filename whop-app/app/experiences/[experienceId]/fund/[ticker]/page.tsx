import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Flame,
  Layers,
  Repeat,
  TrendingUp,
} from "lucide-react";

import { ExperienceShell } from "@/components/experience-shell";
import { WhopRequired } from "@/components/whop-required";
import { getWhopUserId } from "@/lib/whop-auth";
import {
  api,
  type ApiChangeRecord,
  type ApiFundDetail,
  type ApiFundFlow,
  type ApiFundStreak,
  type ApiOptionHolding,
  type ApiOptionRoll,
} from "@/lib/api";
import { aum, directionTone, int, pct, pctUnsigned } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Fund detail. Verifies the Whop JWT, then renders an information-rich
 * profile for a single fund: provider chrome, top holdings, recent changes,
 * and (when present) an option book, streak chips, fund flow, and option
 * rolls. Information architecture follows etf-dashboard/app/fund/[ticker]
 * but is rebuilt against the local UI primitives so it sits inside the
 * Whop shell.
 */
export default async function FundDetailPage({
  params,
}: {
  params: Promise<{ experienceId: string; ticker: string }>;
}) {
  const { experienceId, ticker } = await params;
  const userId = await getWhopUserId();
  if (!userId) return <WhopRequired />;

  const symbol = ticker.toUpperCase();
  const fund = await api.fund(symbol, { throwOnError: false });
  if (!fund) notFound();

  return (
    <ExperienceShell experienceId={experienceId} currentTab={null}>
      <div className="space-y-6">
        <FundHeader fund={fund} experienceId={experienceId} />
        <StatsStrip fund={fund} />
        {fund.flow ? <FundFlowCard flow={fund.flow} /> : null}
        {fund.streaks.length > 0 ? (
          <StreaksRow
            streaks={fund.streaks}
            experienceId={experienceId}
          />
        ) : null}
        <TopHoldingsCard
          holdings={fund.topHoldings}
          experienceId={experienceId}
        />
        {fund.optionsCount > 0 && fund.optionHoldings.length > 0 ? (
          <OptionBookCard
            holdings={fund.optionHoldings}
            experienceId={experienceId}
          />
        ) : null}
        {fund.optionRolls.length > 0 ? (
          <OptionRollsCard rolls={fund.optionRolls} />
        ) : null}
        {fund.catchUp ? <CatchUpCard since={fund.catchUpSince ?? null} /> : null}
        <RecentChangesCard
          changes={fund.recentChanges}
          experienceId={experienceId}
        />
      </div>
    </ExperienceShell>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function FundHeader({
  fund,
  experienceId,
}: {
  fund: ApiFundDetail;
  experienceId: string;
}) {
  const isIncome = fund.category === "option-income";
  const categoryTone = isIncome
    ? "border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10"
    : "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10";

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <Link
          href={`/experiences/${experienceId}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" />
          back to dashboard
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-3xl font-semibold tracking-tight text-primary">
                {fund.fund}
              </span>
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground"
              >
                {fund.provider}
              </Badge>
              <Badge variant="outline" className={`text-xs ${categoryTone}`}>
                {isIncome ? "option income" : "active equity"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              AUM {aum(fund.aum)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Stats strip ────────────────────────────────────────────────────────────

function StatsStrip({ fund }: { fund: ApiFundDetail }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat label="Holdings" value={int(fund.holdingsCount)} />
      <Stat label="Options" value={int(fund.optionsCount)} />
      <Stat
        label="Total weight"
        value={pctUnsigned(fund.totalWeight)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-mono text-lg font-semibold tracking-tight">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Fund flow card ─────────────────────────────────────────────────────────

function FundFlowCard({ flow }: { flow: ApiFundFlow }) {
  const positive = flow.flowPct >= 0;
  const tone: "buying" | "selling" = positive ? "buying" : "selling";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <TrendingUp className="size-4 text-sky-700 dark:text-sky-300" />
        <CardTitle className="text-base">
          Fund flow ({flow.periodDays}d)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FlowStat
            label="Shares outstanding"
            value={int(flow.sharesOutstanding)}
          />
          <FlowStat
            label="Net change"
            value={`${flow.sharesDelta > 0 ? "+" : flow.sharesDelta < 0 ? "-" : ""}${int(
              Math.abs(flow.sharesDelta),
            )}`}
            valueClass={
              flow.sharesDelta === 0
                ? "text-muted-foreground"
                : positive
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-rose-700 dark:text-rose-300"
            }
          />
          <FlowStat
            label="Flow %"
            value={pct(flow.flowPct)}
            badgeTone={directionTone(tone)}
          />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Net creation/redemption over the window, as a percent of shares
          outstanding. Price-free on purpose: share counts are clean, scraper
          prices aren&apos;t.
        </p>
      </CardContent>
    </Card>
  );
}

function FlowStat({
  label,
  value,
  valueClass,
  badgeTone,
}: {
  label: string;
  value: string;
  valueClass?: string;
  badgeTone?: string;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {badgeTone ? (
        <span
          className={`mt-1 inline-flex items-center rounded px-2 py-0.5 text-xs font-mono ${badgeTone}`}
        >
          {value}
        </span>
      ) : (
        <p
          className={`mt-1 font-mono text-lg font-semibold tracking-tight ${valueClass ?? ""}`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

// ─── Streak chips ───────────────────────────────────────────────────────────

function StreaksRow({
  streaks,
  experienceId,
}: {
  streaks: ApiFundStreak[];
  experienceId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Flame className="size-4 text-amber-700 dark:text-amber-300" />
        <CardTitle className="text-base">Active streaks</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {streaks.map((streak) => (
            <StreakPill
              key={`${streak.ticker}-${streak.direction}`}
              streak={streak}
              experienceId={experienceId}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StreakPill({
  streak,
  experienceId,
}: {
  streak: ApiFundStreak;
  experienceId: string;
}) {
  const href = `/experiences/${experienceId}/ticker/${encodeURIComponent(streak.ticker)}`;
  const tone =
    streak.direction === "up"
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20"
      : "border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20";
  const showFlame = streak.days >= 3;
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${tone}`}
    >
      {showFlame ? <Flame className="size-3" /> : null}
      <span className="font-mono font-semibold">{streak.ticker}</span>
      <span className="font-semibold">{streak.days}d</span>
    </Link>
  );
}

// ─── Top holdings table ─────────────────────────────────────────────────────

function TopHoldingsCard({
  holdings,
  experienceId,
}: {
  holdings: ApiFundDetail["topHoldings"];
  experienceId: string;
}) {
  if (holdings.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <Layers className="size-4 text-primary" />
          <CardTitle className="text-base">Top holdings</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No holdings reported for this fund yet.
        </CardContent>
      </Card>
    );
  }

  const rows = holdings.slice(0, 25);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Layers className="size-4 text-primary" />
        <CardTitle className="text-base">Top holdings</CardTitle>
        <span className="ml-auto text-xs text-muted-foreground">
          top {rows.length} by weight
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead className="hidden sm:table-cell">Name</TableHead>
              <TableHead className="hidden md:table-cell">Sector</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Δ weight</TableHead>
              <TableHead className="text-right">Shares</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => {
              const tickerHref = `/experiences/${experienceId}/ticker/${encodeURIComponent(h.ticker)}`;
              // weightDelta is null on a catch-up fund: no delta, not a zero one.
              const weightDelta = h.weightDelta ?? 0;
              const hasDelta = Math.abs(weightDelta) > 0.0005;
              const deltaDirection: "buying" | "selling" =
                weightDelta >= 0 ? "buying" : "selling";
              return (
                <TableRow key={h.ticker}>
                  <TableCell>
                    <Link
                      href={tickerHref}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {h.ticker}
                    </Link>
                    <div className="mt-0.5 text-[11px] text-muted-foreground sm:hidden">
                      <span className="truncate">{h.name}</span>
                      {h.sector ? (
                        <span className="text-muted-foreground/60">
                          {" "}
                          · {h.sector}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] truncate text-muted-foreground sm:table-cell">
                    {h.name}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {h.sector || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {pctUnsigned(h.weight)}
                  </TableCell>
                  <TableCell className="text-right">
                    {hasDelta ? (
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-mono ${directionTone(deltaDirection)}`}
                      >
                        {pct(weightDelta)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {int(h.shares)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Option book ────────────────────────────────────────────────────────────

function OptionBookCard({
  holdings,
  experienceId,
}: {
  holdings: ApiOptionHolding[];
  experienceId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Layers className="size-4 text-violet-700 dark:text-violet-300" />
        <CardTitle className="text-base">Option book</CardTitle>
        <span className="ml-auto text-xs text-muted-foreground">
          {holdings.length} contract{holdings.length === 1 ? "" : "s"}
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Strike</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">DTE</TableHead>
              <TableHead className="text-right">Moneyness</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((h, i) => {
              const tickerHref = `/experiences/${experienceId}/ticker/${encodeURIComponent(h.underlying || h.ticker)}`;
              const isCall = (h.optionType || "").toLowerCase().startsWith("c");
              const typeTone = isCall
                ? "border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10"
                : "border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10";
              return (
                <TableRow key={`${h.ticker}-${h.strike}-${h.expiry}-${i}`}>
                  <TableCell>
                    <Link
                      href={tickerHref}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {h.underlying || h.ticker}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${typeTone}`}>
                      {isCall ? "CALL" : "PUT"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${h.strike}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {h.expiry || "n/a"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {h.dte == null ? "n/a" : `${h.dte}d`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {h.moneyness == null ? "n/a" : pct(h.moneyness)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Option rolls ───────────────────────────────────────────────────────────

function OptionRollsCard({ rolls }: { rolls: ApiOptionRoll[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Repeat className="size-4 text-violet-700 dark:text-violet-300" />
        <CardTitle className="text-base">Option rolls</CardTitle>
        <span className="ml-auto text-xs text-muted-foreground">
          positions rolled, not closed
        </span>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rolls.map((roll, i) => {
            const isCall = (roll.optionType || "")
              .toLowerCase()
              .startsWith("c");
            const fmt = (leg: { strike: number; expiry: string }) =>
              `${isCall ? "C" : "P"}$${leg.strike}${leg.expiry ? ` · ${leg.expiry}` : ""}`;
            return (
              <div
                key={`${roll.underlying}-${i}`}
                className="rounded-md border border-border/60 bg-muted/20 px-3 py-2"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {roll.underlying}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {isCall ? "covered call" : "cash-secured put"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                  {roll.closed.map((leg, j) => (
                    <span
                      key={`c-${j}`}
                      className="text-muted-foreground line-through"
                    >
                      {fmt(leg)}
                    </span>
                  ))}
                  <ArrowRight className="size-3 shrink-0 text-violet-700 dark:text-violet-300" />
                  {roll.opened.map((leg, j) => (
                    <span key={`o-${j}`} className="text-primary">
                      {fmt(leg)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          A roll closes one contract and opens another on the same underlying.
          Routine income mechanics (extending duration or repricing the strike),
          not a directional exit.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Recent changes ─────────────────────────────────────────────────────────

function CatchUpCard({ since }: { since: string | null }) {
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Catch-up{since ? ` since ${since}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        This fund&apos;s issuer data was stale and has just come back. Its
        daily changes are withheld because they would span the whole gap, not
        one day of trading. Normal daily changes resume next session.
      </CardContent>
    </Card>
  );
}

function RecentChangesCard({
  changes,
  experienceId,
}: {
  changes: ApiChangeRecord[];
  experienceId: string;
}) {
  if (changes.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent changes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No position changes detected in the latest window.
        </CardContent>
      </Card>
    );
  }

  const rows = changes.slice(0, 20);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <CardTitle className="text-base">Recent changes</CardTitle>
        <span className="ml-auto text-xs text-muted-foreground">
          showing {rows.length} of {changes.length}
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border/60">
          {rows.map((row, i) => (
            <ChangeRow
              key={`${row.ticker}-${i}`}
              row={row}
              experienceId={experienceId}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ChangeRow({
  row,
  experienceId,
}: {
  row: ApiChangeRecord;
  experienceId: string;
}) {
  const tickerSymbol = row.optionDetails?.underlying ?? row.ticker;
  const tickerHref = `/experiences/${experienceId}/ticker/${encodeURIComponent(tickerSymbol)}`;
  const directionForTone: "buying" | "selling" =
    row.weightDelta >= 0 ? "buying" : "selling";
  const typeTone =
    row.type === "NEW"
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
      : row.type === "REMOVED"
        ? "border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-500/10"
        : "border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10";

  const sharesDeltaLabel =
    row.sharesDelta === 0
      ? null
      : `${row.sharesDelta > 0 ? "+" : "-"}${int(Math.abs(row.sharesDelta))} shares`;

  return (
    <li className="px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={tickerHref}
              className="font-mono font-semibold tracking-tight hover:text-primary"
            >
              {row.ticker}
            </Link>
            <Badge variant="outline" className={typeTone}>
              {row.type}
            </Badge>
            {row.isOption ? (
              <Badge
                variant="outline"
                className="border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10"
              >
                OPTION
              </Badge>
            ) : null}
          </div>
          {row.name ? (
            <p className="truncate text-xs text-muted-foreground">
              {row.name}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0 sm:flex-col sm:items-end sm:gap-1">
          <span
            className={`text-xs px-2 py-0.5 rounded ${directionTone(directionForTone)}`}
          >
            {pct(row.weightDelta)}
          </span>
          {sharesDeltaLabel ? (
            <span className="text-[11px] text-muted-foreground">
              {sharesDeltaLabel}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
