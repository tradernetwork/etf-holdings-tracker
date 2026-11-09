import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_URL ?? "https://api.tickertrace.pro";

// Vercel packs every file a server function might fs-read into that function,
// and the history dir is ~270MB (one CSV per day). That blew the 250MB limit
// and every production deploy since 2026-10-29 failed. The pages only read the
// directory listing plus the newest two snapshots (lib/holdings.ts), so keep the
// newest few in the function bundle and trace-exclude the rest. The full history
// still ships as static assets under public/ (not counted against function
// size) and stays on the API, so nothing is deleted. Re-evaluated on every
// build, and the nightly scrape commit triggers one, so "newest" stays current.
const HISTORY_KEEP_IN_FUNCTIONS = 7;
function olderHistoryFiles(): string[] {
  const dir = path.join(process.cwd(), "public", "data", "history");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^holdings_\d{4}-\d{2}-\d{2}\.csv$/.test(f))
    .sort()
    .slice(0, -HISTORY_KEEP_IN_FUNCTIONS)
    .map((f) => `./public/data/history/${f}`);
}

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": olderHistoryFiles(),
  },

  // Proxy /api/v1/* on tickertrace.pro through to the FastAPI server on
  // Vultr. Lets us advertise a single domain in docs and marketing.
  //
  // Note: tickertrace.pro/api/signals (singular, no v1) is still served by
  // the Next.js route at app/api/signals/route.ts — Next prefers a local
  // route over a rewrite when both match, so the existing endpoint keeps
  // working.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
