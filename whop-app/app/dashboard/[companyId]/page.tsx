import { whopSdk } from "@/lib/whop-sdk";
import { getWhopUserId } from "@/lib/whop-auth";
import { WhopRequired } from "@/components/whop-required";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { BroadcastComposer } from "@/components/broadcast-composer";
import { buildBroadcast } from "@/lib/brief";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, Layers, Link2, ListChecks, Megaphone } from "lucide-react";
import Link from "next/link";

/**
 * Admin dashboard view. Whop renders this inside the company-owner's
 * settings panel for the app — this is the creator-utility surface Whop's
 * app review looks for. It does three things:
 *
 *   1. Embeds the real Broadcast composer (same component + server action
 *      the in-app Broadcast tab uses) so an admin can push the daily brief
 *      to their community without ever opening the experience.
 *   2. Shows a live preview of what members see today, so the admin can
 *      confirm the app is doing something before they push anything.
 *   3. Explains the daily workflow in plain language.
 *
 * There's no persistence layer in this app (by design — it's a pure
 * frontend over the public TickerTrace API), so nothing here is
 * "configuration" in the traditional sense. The composer IS the
 * configuration surface.
 *
 * Only renders for users with admin access to the company; anyone else
 * gets notFound() so we don't leak experience IDs.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const userId = await getWhopUserId();
  if (!userId) return <WhopRequired />;

  try {
    const access = await whopSdk.access.checkIfUserHasAccessToCompany({
      userId,
      companyId,
    });
    if (access.accessLevel !== "admin") notFound();
  } catch {
    // checkIfUserHasAccessToCompany can throw if the company id is bogus
    // or the SDK is misconfigured — treat that as "no access" rather than
    // a 500 so the admin can read the error in-context.
    notFound();
  }

  // Resolve the experience this app is installed as, for this company, so
  // we can embed the real Broadcast composer here. A company can in theory
  // have more than one install of the same app; we take the first one,
  // which matches how a single-hub app like this is normally installed.
  const experienceId = await resolveExperienceId(companyId);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 sm:px-6 space-y-6">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" />
            Installed and running
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            TickerTrace is live in your community
          </h1>
          <p className="text-sm text-muted-foreground">
            The theme follows your Whop, light or dark, automatically.
            There&apos;s nothing to configure here because there&apos;s
            nothing to break, but there is one thing worth doing daily:
            broadcast today&apos;s brief. You can do that right below.
          </p>
        </header>

        {experienceId ? (
          <BroadcastPreview experienceId={experienceId} />
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-3">
              <Megaphone className="size-4 text-primary" />
              <CardTitle className="text-base">
                Broadcast from inside the app
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              We couldn&apos;t automatically confirm which community
              experience this install belongs to, so the composer isn&apos;t
              embedded here. Open TickerTrace from your community sidebar
              instead — as an admin you&apos;ll see a{" "}
              <span className="font-medium text-foreground">Broadcast</span>{" "}
              tab there that members don&apos;t see, with the same one-tap
              push.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <ListChecks className="size-4 text-primary" />
            <CardTitle className="text-base">
              How to use this with your community
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Once a day (mornings work best, right after the overnight
              holdings scrape), skim the brief above, add a one-line note if
              something stands out to you, and send it. Members get a
              notification that opens straight into the app.
            </p>
            <p>
              That&apos;s the whole loop: it&apos;s a daily reason for
              members to come back, and a daily piece of content you
              don&apos;t have to write from scratch. Nothing else needs
              setup, and there&apos;s no paywall or tier to manage.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <Layers className="size-4 text-primary" />
            <CardTitle className="text-base">What members see</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Signals · Briefing · Changes · Divergences · Sectors as the five
              top-level tabs, plus per-fund and per-ticker deep dives, a daily
              brief summary, a signal track record, and a trending-tickers
              row. Everything is read-only and tied to the public
              TickerTrace API.
            </p>
            <p>
              Members don&apos;t need an account, key, or subscription. As
              long as they have access to your Whop, they have access to the
              dashboard.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <Link2 className="size-4 text-primary" />
            <CardTitle className="text-base">Useful links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <LinkRow
              label="Public dashboard"
              href="https://tickertrace.pro"
              hint="The version that lives outside Whop"
            />
            <LinkRow
              label="API docs"
              href="https://api.tickertrace.pro/docs"
              hint="Swagger reference for the underlying endpoints"
            />
            <LinkRow
              label="Source on GitHub"
              href="https://github.com/tradernetwork/etf-holdings-tracker"
              hint="Scraper, normalizer, API, dashboards — all of it"
            />
          </CardContent>
        </Card>

        <p className="text-[11px] text-muted-foreground">
          Company id: <span className="font-mono">{companyId}</span>
        </p>
      </div>
    </main>
  );
}

/**
 * Finds the experienceId this app is installed as for the given company, by
 * asking Whop for experiences under this company scoped to our own app id.
 * Best-effort: any failure (missing scope, network blip, zero results)
 * resolves to null and the page falls back to pointing the admin at the
 * in-app Broadcast tab instead of embedding the composer.
 */
async function resolveExperienceId(companyId: string): Promise<string | null> {
  const appId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
  if (!appId) return null;
  try {
    const result = await whopSdk.experiences.listExperiences({
      companyId,
      appId,
      first: 1,
    });
    return result?.experiencesV2?.nodes?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The live composer, embedded directly in the admin dashboard. This is the
 * exact same BroadcastComposer + broadcastBrief server action the in-app
 * Broadcast tab uses — the action re-checks admin access against
 * `experienceId` server-side regardless of how the composer got rendered,
 * so there's no new trust boundary here.
 */
async function BroadcastPreview({ experienceId }: { experienceId: string }) {
  const payload = await api.signals({ throwOnError: false });

  if (!payload) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t reach the TickerTrace API. Give it a minute and
          reload before broadcasting.
        </CardContent>
      </Card>
    );
  }

  const brief = buildBroadcast(payload);

  if (brief.isEmpty) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No signals on the tape today — nothing to broadcast yet. Check
          back after the next scrape.
        </CardContent>
      </Card>
    );
  }

  return (
    <BroadcastComposer
      experienceId={experienceId}
      briefText={brief.briefText}
      pushTitle={brief.pushTitle}
      pushSummary={brief.pushSummary}
      topBuys={brief.topBuys}
      topSells={brief.topSells}
    />
  );
}

function LinkRow({
  label,
  href,
  hint,
}: {
  label: string;
  href: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md border border-border/60 hover:border-primary/40 hover:bg-card transition-colors px-3 py-2"
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{hint}</p>
      </div>
      <Link2 className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
