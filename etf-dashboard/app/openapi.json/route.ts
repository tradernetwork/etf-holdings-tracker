/**
 * Same-origin proxy for the API's OpenAPI spec at tickertrace.pro/openapi.json,
 * so agents and tooling that probe the site root can find it. The FastAPI app
 * is the single source of truth; we just cache it for an hour.
 */

export const revalidate = 3600;

const UPSTREAM = "https://api.tickertrace.pro/openapi.json";

export async function GET() {
  try {
    const res = await fetch(UPSTREAM, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return new Response(await res.text(), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "OpenAPI spec temporarily unavailable", source: UPSTREAM }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
