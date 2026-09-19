import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import type { ApiTraderMatrixHandoff } from "@/lib/api";

export function TraderMatrixCard({ handoff }: { handoff: ApiTraderMatrixHandoff | null }) {
  if (!handoff) return null;

  return (
    <Card className="border-dashed border-border/60 bg-muted/10">
      <CardContent className="py-4 space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Go deeper</p>
        <CardTitle className="text-base">{handoff.name}</CardTitle>
        <p className="text-sm text-muted-foreground">{handoff.tagline}</p>
        <p className="text-sm text-muted-foreground">{handoff.why}</p>
        <Link
          href={handoff.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Learn more about {handoff.name}
          <ArrowRight className="size-3" />
        </Link>
        {handoff.is_referral ? (
          <p className="text-xs text-muted-foreground">
            Referral link, using it supports this app at no extra cost to you.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}