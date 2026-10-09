import { SectionSkeleton } from "@/components/section-skeleton";

/**
 * Shown while the experience page resolves the Whop session. Kept free of
 * data fetches so it paints instantly on first load and on tab switches.
 */
export default function Loading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 space-y-4">
        <SectionSkeleton rows={1} />
        <SectionSkeleton rows={5} />
      </div>
    </main>
  );
}
