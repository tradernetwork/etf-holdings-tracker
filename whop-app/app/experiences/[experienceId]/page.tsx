import { ExperienceShell, type ExperienceTab } from "@/components/experience-shell";
import { WhopRequired } from "@/components/whop-required";
import { getExperienceAccess, getWhopUser } from "@/lib/whop-auth";
import { SignalsTab } from "@/components/tabs/signals-tab";
import { BriefingTab } from "@/components/tabs/briefing-tab";
import { ChangesTab } from "@/components/tabs/changes-tab";
import { DivergencesTab } from "@/components/tabs/divergences-tab";
import { SectorsTab } from "@/components/tabs/sectors-tab";
import { BroadcastTab } from "@/components/tabs/broadcast-tab";
import { TickerSearchForm } from "@/components/ticker-search";
import { DailyBriefCard } from "@/components/daily-brief-card";
import { TrendingTickers } from "@/components/trending-tickers";
import { TrackRecordCard } from "@/components/track-record-card";
import { TraderMatrixCard } from "@/components/trader-matrix-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  api,
  type ApiSignal,
  type ApiFullPayload,
  type ApiBriefing,
  type ApiSignalPerformance,
  type ApiTraderMatrixHandoff,
} from "@/lib/api";

const TAB_IDS = [
  "signals",
  "briefing",
  "changes",
  "divergences",
  "sectors",
  "broadcast",
] as const satisfies readonly ExperienceTab[];

function normalizeTab(raw: string | string[] | undefined): ExperienceTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (TAB_IDS as readonly string[]).includes(value ?? "")
    ? (value as ExperienceTab)
    : "signals";
}

function flattenSearchParams(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export default async function ExperiencePage({
  params,
  searchParams,
}: {
  params: Promise<{ experienceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { experienceId } = await params;
  const sp = await searchParams;
  const requestedTab = normalizeTab(sp.tab);

  // Gate on a verifiable Whop session, and learn whether this user is an admin
  // of the experience (controls the creator-only Broadcast tab).
  const access = await getExperienceAccess(experienceId);
  if (!access) return <WhopRequired />;
  const isAdmin = access.accessLevel === "admin";

  // Broadcast is admin-only. A non-admin landing on ?tab=broadcast (e.g. a
  // shared deep link, or someone poking at the URL) should get a clear,
  // honest message rather than a silent redirect back to Signals — a
  // reviewer testing access boundaries should see the app say what's going
  // on, not quietly pretend the tab doesn't exist.
  const deniedBroadcast = requestedTab === "broadcast" && !isAdmin;
  const tab: ExperienceTab = deniedBroadcast ? "broadcast" : requestedTab;

  // Greeting is best-effort cosmetic — never gates anything.
  const user = await getWhopUser();
  const greeting = user?.name ?? user?.username ?? undefined;
  const flatSp = flattenSearchParams(sp);

  // Headline data for the top-of-page brief, the trending row, the track
  // record card, and the TraderMatrix footnote. Fetched once here (Next.js
  // dedupes identical fetch() calls made again inside individual tabs during
  // the same request) and skipped entirely on the broadcast tab, which has
  // its own focused view. Every fetch is best-effort — a missing card here
  // should never block the page.
  let payload: ApiFullPayload | null = null;
  let briefing: ApiBriefing | null = null;
  let signalPerformance: ApiSignalPerformance | null = null;
  let tradermatrix: ApiTraderMatrixHandoff | null = null;
  if (tab !== "broadcast") {
    [payload, briefing, signalPerformance, tradermatrix] = await Promise.all([
      api.signals({ throwOnError: false }),
      api.briefing({ throwOnError: false }),
      api.signalPerformance(),
      api.tradermatrix({ throwOnError: false }),
    ]);
  }

  const trending: ApiSignal[] = payload
    ? [...payload.signals.buying.slice(0, 3), ...payload.signals.selling.slice(0, 3)]
    : [];

  return (
    <ExperienceShell
      experienceId={experienceId}
      currentTab={tab}
      greeting={greeting}
      isAdmin={isAdmin}
    >
      <div className="space-y-4">
        {tab === "broadcast" ? null : (
          <>
            {briefing ? (
              <DailyBriefCard briefing={briefing} experienceId={experienceId} />
            ) : null}
            <TickerSearchForm experienceId={experienceId} />
            <TrendingTickers signals={trending} experienceId={experienceId} />
          </>
        )}

        {deniedBroadcast ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              The Broadcast tab is for community admins only. If you think
              you should have access, check with whoever manages this
              community&apos;s Whop.
            </CardContent>
          </Card>
        ) : (
          <>
            {tab === "signals" ? <SignalsTab experienceId={experienceId} /> : null}
            {tab === "briefing" ? <BriefingTab experienceId={experienceId} /> : null}
            {tab === "changes" ? (
              <ChangesTab experienceId={experienceId} searchParams={flatSp} />
            ) : null}
            {tab === "divergences" ? (
              <DivergencesTab experienceId={experienceId} />
            ) : null}
            {tab === "sectors" ? <SectorsTab /> : null}
            {tab === "broadcast" ? (
              <BroadcastTab experienceId={experienceId} />
            ) : null}
          </>
        )}

        {tab === "broadcast" ? null : (
          <>
            <TrackRecordCard performance={signalPerformance} />
            <TraderMatrixCard handoff={tradermatrix} />
          </>
        )}
      </div>
    </ExperienceShell>
  );
}
