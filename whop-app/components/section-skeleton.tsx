/**
 * Placeholder for a data section that is still streaming in. Pages render
 * their chrome (header, tabs) immediately and wrap each API-backed section
 * in <Suspense fallback={<SectionSkeleton />}> so a slow TickerTrace API
 * never leaves the member staring at a blank iframe.
 */
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-3 animate-pulse"
    >
      <div className="h-4 w-40 rounded bg-muted" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 rounded-md bg-muted/70" />
      ))}
    </div>
  );
}
