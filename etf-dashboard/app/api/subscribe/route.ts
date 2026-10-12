import { NextRequest, NextResponse } from 'next/server';

/** Simple email capture webhook.
 *  Posts {email, placement} to SUBSCRIBE_WEBHOOK_URL if set.
 *  Returns 503 {error:'not_configured'} when the env var is absent — so the
 *  UI can degrade honestly rather than silently dropping the submission. */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.email !== 'string') {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    const placement = typeof body.placement === 'string' ? body.placement : 'unknown';

    // Basic email shape check — not trying to RFC 5321 validate, just catch
    // obvious garbage before forwarding to the webhook.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    }

    const webhookUrl = process.env.SUBSCRIBE_WEBHOOK_URL;
    if (!webhookUrl) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, placement, source: 'tickertrace' }),
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
