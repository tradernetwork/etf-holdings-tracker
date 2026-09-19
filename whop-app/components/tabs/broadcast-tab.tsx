import { api } from "@/lib/api";
import { buildBroadcast } from "@/lib/brief";
import { BroadcastComposer } from "@/components/broadcast-composer";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Admin-only broadcast surface. Fetches today's headline payload, builds the
 * brief, and hands it to the client composer. Access is gated by the parent
 * page (the tab only renders for admins) and re-checked in the action; this
 * component just owns the data fetch and the empty states.
 */
export async function BroadcastTab({
  experienceId,
}: {
  experienceId: string;
}) {
  const payload = await api.signals({ throwOnError: false });

  if (!payload) {
    return (
      <EmptyState message="Couldn't reach the TickerTrace API. Give it a minute and reload before broadcasting." />
    );
  }

  const brief = buildBroadcast(payload);

  if (brief.isEmpty) {
    return (
      <EmptyState message="No signals on the tape today — nothing to broadcast yet. Check back after the next scrape." />
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

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}
