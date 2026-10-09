'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Persistent header search — a single icon button on every route (per
 * docs/REDESIGN-PLAN.md Phase 3: "lookup is the dominant intent and
 * currently has no permanent home"). Opens a small dropdown with a ticker
 * lookup that GETs to /dashboard?q=..., the same contract
 * components/ticker-search.tsx already uses (app/dashboard/page.tsx reads
 * `searchParams.q`) — this is a new, self-contained component rather than a
 * reuse of TickerSearchForm because that component is inline-styled for its
 * spot in the dashboard page body, and this task's file ownership doesn't
 * extend to editing it to make it portable.
 *
 * The input only exists in the DOM while the dropdown is open (not just
 * CSS-hidden). On /dashboard, components/keyboard-search.tsx already binds
 * "/" to focus the first `input[name="q"]` on the page — mounting a second,
 * always-present one here would race it. Keeping this one absent until
 * opened means that shortcut still finds the original dashboard input when
 * this is closed, and finds this one instead when the user opened it.
 */
export function NavSearch() {
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && open) {
                setOpen(false);
                return;
            }
            if (e.key === '/' && !open
                && !(e.target instanceof HTMLInputElement)
                && !(e.target instanceof HTMLTextAreaElement)) {
                e.preventDefault();
                setOpen(true);
            }
        }
        function onClickOutside(e: MouseEvent) {
            if (open && wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onClickOutside);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onClickOutside);
        };
    }, [open]);

    return (
        <div ref={wrapRef} className="relative shrink-0">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-label="Search a ticker"
                aria-expanded={open}
                className="inline-flex items-center justify-center h-11 w-11 md:h-9 md:w-9 rounded-lg border border-rule-strong bg-surface-alt text-slate-400 hover:text-white hover:border-equity/50 transition-colors"
            >
                <Search className="h-4 w-4" />
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1.5rem)] z-[60] bg-surface border border-rule rounded-xl shadow-xl p-3">
                    {/* No onSubmit handler here on purpose: this is a plain
                        GET form doing a full navigation to /dashboard. A
                        handler that called setOpen(false) synchronously
                        unmounted the dropdown — and the form inside it —
                        before the browser could act on the submit, which
                        silently swallowed every search (confirmed via a
                        real submit: the browser logged "Form submission
                        canceled because the form is not connected"). The
                        navigation itself closes this dropdown for free. */}
                    <form action="/dashboard" method="GET" className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                            ref={inputRef}
                            type="text"
                            name="q"
                            placeholder="Search any ticker..."
                            autoComplete="off"
                            className="w-full bg-surface-alt border border-rule rounded-lg pl-10 pr-10 py-2.5 text-base sm:text-sm text-white placeholder-slate-500 font-mono uppercase focus:outline-none focus:border-equity/50 focus:ring-1 focus:ring-equity/20 transition-colors"
                        />
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close search"
                            className="absolute right-0 top-1/2 -translate-y-1/2 p-3 text-slate-500 hover:text-white transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </form>
                    <p className="text-[10px] text-slate-500 mt-1.5">Enter jumps to Signals with the ticker looked up.</p>
                </div>
            )}
        </div>
    );
}
