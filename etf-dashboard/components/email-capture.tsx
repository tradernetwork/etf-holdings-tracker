'use client';

import { useState, useRef } from 'react';
import { ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';

type State = 'idle' | 'submitting' | 'success' | 'error' | 'not_configured';

/** Reusable email capture form. Posts JSON {email, placement} to /api/subscribe.
 *  Shows honest success / failure states. Use `placement` to identify the
 *  capture point (e.g. "email_capture_landing", "email_capture_dashboard"). */
export function EmailCapture({ placement }: { placement: string }) {
    const [state, setState] = useState<State>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const email = inputRef.current?.value.trim() ?? '';
        if (!email) return;
        setState('submitting');
        setErrorMsg('');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, placement }),
            });
            if (res.ok) {
                setState('success');
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (res.status === 503 || data.error === 'not_configured') {
                setState('not_configured');
            } else if (data.error === 'invalid_email') {
                setState('error');
                setErrorMsg("That doesn't look like a valid email address.");
            } else {
                setState('error');
                setErrorMsg('Something went wrong on our end. Try again later.');
            }
        } catch {
            setState('error');
            setErrorMsg('Network error — check your connection and try again.');
        }
    }

    if (state === 'success') {
        return (
            <div className="flex items-center justify-center gap-2 text-sm text-buy">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>You&apos;re in — we&apos;ll send the recap Sunday morning.</span>
            </div>
        );
    }

    if (state === 'not_configured') {
        return (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                <AlertCircle className="h-4 w-4 shrink-0 text-sell/60" />
                <span>Email capture isn&apos;t wired up yet — check back soon.</span>
            </div>
        );
    }

    return (
        <form
            onSubmit={handleSubmit}
            noValidate
            className="flex gap-2 flex-wrap justify-center"
        >
            <input
                ref={inputRef}
                type="email"
                required
                placeholder="you@email.com"
                disabled={state === 'submitting'}
                className="flex-1 min-w-[200px] max-w-[360px] bg-surface border border-rule rounded-xl px-4 py-3 text-base sm:text-sm text-white placeholder-slate-500 outline-none focus:border-equity/60 transition-colors disabled:opacity-50"
            />
            <button
                type="submit"
                disabled={state === 'submitting'}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-equity text-canvas text-sm font-bold hover:bg-white transition-colors disabled:opacity-50"
            >
                {state === 'submitting' ? 'Subscribing…' : (
                    <><span>Subscribe</span><ArrowRight className="h-4 w-4" /></>
                )}
            </button>
            {state === 'error' && errorMsg && (
                <p className="w-full text-center text-xs text-sell/80 mt-1">{errorMsg}</p>
            )}
        </form>
    );
}
