import { NextRequest, NextResponse } from 'next/server';

// ponytail: per-instance in-memory limiter. Serverless instances don't share it,
// so it only blunts casual abuse; put a real limiter (KV/Upstash) in front if
// the webhook ever gets hammered.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function tooMany(ip: string): boolean {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length > MAX_PER_WINDOW;
}

/** Email capture. Forwards {email, placement} to SUBSCRIBE_WEBHOOK_URL (server
 *  env only, never client-supplied). Same-origin only, rate limited, bounded
 *  input. Returns 503 {error:'not_configured'} when the env var is absent so
 *  the UI can say so instead of silently dropping the address. */
export async function POST(req: NextRequest) {
    let originHost: string | null = null;
    try { originHost = new URL(req.headers.get('origin') ?? '').host; } catch { /* missing or "null" */ }
    if (!originHost || originHost !== req.headers.get('host')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    if (tooMany(ip)) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.email !== 'string') {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    }
    const placement = typeof body.placement === 'string' && /^[a-z_]{1,40}$/.test(body.placement)
        ? body.placement
        : 'unknown';

    const webhookUrl = process.env.SUBSCRIBE_WEBHOOK_URL;
    if (!webhookUrl) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, placement, source: 'tickertrace' }),
            signal: AbortSignal.timeout(8000),
            cache: 'no-store',
        });
        if (!res.ok) {
            console.error(`subscribe webhook returned ${res.status}`);
            return NextResponse.json({ error: 'webhook_error' }, { status: 502 });
        }
    } catch (err) {
        console.error('subscribe webhook fetch failed:', err);
        return NextResponse.json({ error: 'webhook_error' }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
}
