'use client';

/**
 * AskTickerTrace — multi-provider BYOK chat over our own holdings data.
 *
 * User picks Gemini / Anthropic / OpenAI / OpenRouter, pastes their key,
 * and chats. Each provider's API is called direct from the browser; the
 * key never touches our server. Tool calls hit the open TickerTrace API
 * (also direct from the browser, no auth needed).
 */

import { useState, useRef, useEffect, FormEvent } from 'react';
import { Send, Loader2, MessageSquare, Sparkles, KeyRound, ExternalLink, X, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
    runChat,
    PROVIDERS,
    type ProviderId,
    type ChatTurn,
    type CommonTool,
} from '@/lib/chat-providers';
import { TMMark } from '@/components/tm-mark';
import { TMLink } from '@/components/tm-link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.tickertrace.pro';
const STORAGE_PROVIDER = 'tt_chat_provider';
// Keys are stored one per provider so users can keep keys for several.
const keyStorageId = (p: ProviderId) => `tt_chat_key_${p}`;
const modelStorageId = (p: ProviderId) => `tt_chat_model_${p}`;

const STARTER_PROMPTS = [
    'What are institutions buying today?',
    "Who's accumulating GOOGL?",
    'Show me ARK’s biggest moves',
    'Do these signals actually make money?',
];

/** Keywords in the user's last question that trigger the TraderLady handoff card. */
const FLOW_KEYWORDS = ['sweep', 'gex', 'dark pool', 'congress', 'flow', 'unusual activity', 'blocks', 'options flow', 'traderlady', 'tradermatrix'];

function hasFlowKeyword(text: string): boolean {
    const lower = text.toLowerCase();
    return FLOW_KEYWORDS.some(k => lower.includes(k));
}

const SYSTEM_PROMPT = `You are TickerTrace's analyst assistant. You answer questions about institutional ETF holdings — what funds like ARK Invest, YieldMax, Avantis, Corgi Funds, Roundhill, REX Shares, Kurv, and NestYield are buying, selling, and holding.

Rules:
- Always use the tools to ground your answers in real data — never invent numbers.
- Be concise. 2-4 short paragraphs unless the user explicitly asks for more.
- When citing data, mention the fund ticker and the actual numbers (weight %, share counts, dates).
- If a user asks a stock-picking or "should I buy" question, decline gracefully: TickerTrace surfaces what institutions are doing, it doesn't give advice.
- Today's date in the data is the most recent date returned by tools — say it explicitly when relevant.
- Plain markdown for output. No code blocks unless showing raw data.
- If a tool returns an error, try a different tool or admit the data wasn't available.`;

const TOOLS: CommonTool[] = [
    {
        name: 'get_signals',
        description: 'Top buy and sell signals across all tracked ETFs for the most recent trading day, with AUM-weighted conviction scores.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_changes',
        description: 'Filterable list of daily position changes across funds. Use for provider-specific or direction-specific lookups.',
        parameters: {
            type: 'object',
            properties: {
                provider: { type: 'string' },
                fund: { type: 'string' },
                direction: { type: 'string', enum: ['buying', 'selling'] },
                limit: { type: 'integer' },
            },
        },
    },
    {
        name: 'get_fund_detail',
        description: 'Holdings, recent changes, options activity, and AUM for one fund. Use when asked about a specific fund.',
        parameters: { type: 'object', properties: { fund: { type: 'string' } }, required: ['fund'] },
    },
    {
        name: 'get_ticker_detail',
        description: 'Cross-fund view: every fund that holds a given ticker, with weights and recent changes.',
        parameters: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] },
    },
    {
        name: 'get_sector_flow',
        description: 'Sector-level money flow — which sectors had net inflows or outflows in the latest day.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_divergences',
        description: 'Tickers where some funds are buying while others are selling, especially within the same provider.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'get_signal_performance',
        description: 'Backtest results: historical median forward return and win rate of TickerTrace buy/sell signals over a 30-day window.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'list_funds',
        description: 'List of every tracked fund with provider and AUM.',
        parameters: { type: 'object', properties: {} },
    },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    let url: string;
    switch (name) {
        case 'get_signals': url = `${API_BASE}/api/v1/signals`; break;
        case 'get_changes': {
            const qs = new URLSearchParams();
            if (args.provider) qs.set('provider', String(args.provider));
            if (args.fund) qs.set('fund', String(args.fund));
            if (args.direction) qs.set('direction', String(args.direction));
            if (args.limit) qs.set('limit', String(args.limit));
            url = `${API_BASE}/api/v1/changes${qs.toString() ? `?${qs}` : ''}`;
            break;
        }
        case 'get_fund_detail':
            url = `${API_BASE}/api/v1/fund/${encodeURIComponent(String(args.fund))}`;
            break;
        case 'get_ticker_detail':
            url = `${API_BASE}/api/v1/ticker/${encodeURIComponent(String(args.ticker))}`;
            break;
        case 'get_sector_flow': url = `${API_BASE}/api/v1/sectors`; break;
        case 'get_divergences': url = `${API_BASE}/api/v1/divergences`; break;
        case 'get_signal_performance': url = `${API_BASE}/api/v1/signal-performance`; break;
        case 'list_funds': url = `${API_BASE}/api/v1/funds`; break;
        default: return { error: `Unknown tool: ${name}` };
    }
    try {
        const res = await fetch(url, { headers: { 'X-TickerTrace-Client': 'web' } });
        if (!res.ok) return { error: `API ${res.status} on ${name}` };
        return await res.json();
    } catch (e) {
        return { error: String(e) };
    }
}

export function AskTickerTrace() {
    const [hydrated, setHydrated] = useState(false);
    const [provider, setProvider] = useState<ProviderId>('gemini');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');
    const [messages, setMessages] = useState<ChatTurn[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Hydrate from localStorage on mount.
    useEffect(() => {
        const storedProvider = (localStorage.getItem(STORAGE_PROVIDER) as ProviderId | null) ?? 'gemini';
        setProvider(storedProvider);
        setApiKey(localStorage.getItem(keyStorageId(storedProvider)) ?? '');
        setModel(localStorage.getItem(modelStorageId(storedProvider)) ?? '');
        setHydrated(true);
    }, []);

    // When the provider changes, load the saved key + model for it (or fall
    // back to empty / the provider's default).
    function switchProvider(p: ProviderId) {
        setProvider(p);
        localStorage.setItem(STORAGE_PROVIDER, p);
        setApiKey(localStorage.getItem(keyStorageId(p)) ?? '');
        setModel(localStorage.getItem(modelStorageId(p)) ?? '');
    }

    function saveKey(k: string) {
        setApiKey(k);
        if (k.trim()) localStorage.setItem(keyStorageId(provider), k.trim());
        else localStorage.removeItem(keyStorageId(provider));
    }

    function saveModel(m: string) {
        setModel(m);
        if (m.trim()) localStorage.setItem(modelStorageId(provider), m.trim());
        else localStorage.removeItem(modelStorageId(provider));
    }

    useEffect(() => {
        // Only auto-scroll once a conversation is underway. Firing on mount
        // (empty chat) would yank the whole page down to this card, scrolling
        // past the dashboard's top-of-page leaderboard.
        if (messages.length === 0) return;
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading, progress]);

    const providerMeta = PROVIDERS[provider];
    const hasKey = hydrated && !!apiKey;
    const effectiveModel = model.trim() || providerMeta.defaultModel;

    async function send(text: string) {
        if (!text.trim() || loading) return;
        if (!hasKey) { setSettingsOpen(true); return; }
        setError(null);
        setProgress(null);
        const next: ChatTurn[] = [...messages, { role: 'user', content: text.trim() }];
        setMessages(next);
        setInput('');
        setLoading(true);
        try {
            const reply = await runChat({
                provider,
                apiKey,
                model: effectiveModel,
                systemPrompt: SYSTEM_PROMPT,
                history: next,
                tools: TOOLS,
                callTool,
                onProgress: setProgress,
            });
            setMessages([...next, { role: 'assistant', content: reply || '(no answer)' }]);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
            setProgress(null);
        }
    }

    function onSubmit(e: FormEvent) {
        e.preventDefault();
        void send(input);
    }

    return (
        <div className="bg-gradient-to-br from-surface to-surface-gradient border border-meta/30 rounded-xl shadow-lg shadow-meta/5 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-rule flex items-center gap-2 bg-surface-alt/50">
                <Sparkles className="h-4 w-4 text-meta" />
                <h2 className="text-sm font-bold text-white">Ask TickerTrace</h2>
                <span className="text-[10px] text-slate-500 ml-1">
                    BYOK · grounded in real holdings data
                </span>
                <button
                    onClick={() => setSettingsOpen(s => !s)}
                    className="ml-auto flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
                    title="Provider and API key settings"
                >
                    <KeyRound className="h-3.5 w-3.5" />
                    {hasKey ? `${providerMeta.label} · key set` : 'Configure'}
                    <ChevronDown className={`h-3 w-3 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Settings drawer */}
            {(settingsOpen || (hydrated && !hasKey)) && (
                <div className="px-4 py-3 border-b border-rule bg-surface-alt/80 space-y-3">
                    {/* Provider selector */}
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5 block">
                            Provider
                        </label>
                        <div className="flex gap-1.5 flex-wrap">
                            {Object.values(PROVIDERS).map(p => {
                                const isActive = p.id === provider;
                                const hasStoredKey = hydrated && !!localStorage.getItem(keyStorageId(p.id));
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => switchProvider(p.id)}
                                        className={`text-xs px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5 ${isActive
                                            ? 'bg-meta/15 border-meta/50 text-white'
                                            : 'bg-surface-elevated border-rule-strong text-slate-300 hover:border-meta/40 hover:text-white'
                                        }`}
                                    >
                                        {p.label}
                                        {hasStoredKey && !isActive && (
                                            <span className="h-1.5 w-1.5 rounded-full bg-buy" title="Key saved" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                            {providerMeta.description}{' '}
                            <a
                                href={providerMeta.signupUrl}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-meta hover:text-white underline underline-offset-2"
                            >
                                Get a {providerMeta.label} key <ExternalLink className="h-3 w-3" />
                            </a>
                        </p>
                    </div>

                    {/* API key */}
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5 block">
                            API key — never leaves your browser
                        </label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={e => saveKey(e.target.value)}
                                placeholder={providerMeta.keyPlaceholder}
                                className="flex-1 bg-canvas border border-rule rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-meta/60"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            {hasKey && (
                                <button
                                    type="button"
                                    onClick={() => saveKey('')}
                                    className="px-3 py-2 rounded-lg bg-surface-elevated border border-rule-strong text-xs text-slate-300 hover:text-[#ff8888] hover:border-sell/40 transition-colors flex items-center gap-1"
                                    title="Forget this provider's key"
                                >
                                    <X className="h-3 w-3" /> Forget
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Optional model override */}
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5 block">
                            Model (optional — defaults to {providerMeta.defaultModel})
                        </label>
                        <input
                            type="text"
                            value={model}
                            onChange={e => saveModel(e.target.value)}
                            placeholder={providerMeta.defaultModel}
                            className="w-full bg-canvas border border-rule rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-meta/60"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                </div>
            )}

            {/* Conversation */}
            <div className="max-h-[420px] overflow-y-auto px-4 py-3 space-y-3">
                {messages.length === 0 && !loading && (
                    <div className="text-slate-400 text-sm space-y-3">
                        <p className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-meta" />
                            Ask anything about what institutions are doing. Try one of these:
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {STARTER_PROMPTS.map(p => (
                                <button
                                    key={p}
                                    onClick={() => void send(p)}
                                    className="text-xs px-3 py-1.5 rounded-full bg-surface-elevated border border-rule-strong text-slate-300 hover:border-meta/40 hover:bg-meta/10 hover:text-white transition-colors"
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((m, i) => (
                    <div
                        key={i}
                        className={
                            m.role === 'user'
                                ? 'bg-surface-elevated border border-rule-strong rounded-lg px-3 py-2 text-sm text-white max-w-[85%] ml-auto'
                                : 'bg-surface-alt border border-meta/15 rounded-lg px-3 py-2 text-sm text-slate-200 max-w-[92%]'
                        }
                    >
                        {m.role === 'assistant' ? (
                            <div className="leading-relaxed [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:text-white [&_strong]:font-semibold [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-white [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-2 [&_h3]:mb-1 [&_code]:bg-surface-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:text-equity">
                                <ReactMarkdown>{m.content}</ReactMarkdown>
                            </div>
                        ) : (
                            m.content
                        )}
                    </div>
                ))}

                {loading && (
                    <div className="bg-surface-alt border border-meta/15 rounded-lg px-3 py-2 text-sm text-slate-400 max-w-[92%] flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-meta" />
                        <span>{progress ?? 'Thinking…'}</span>
                    </div>
                )}

                {error && (
                    <div className="bg-sell/10 border border-sell/30 rounded-lg px-3 py-2 text-xs text-[#ff8888]">
                        {error}
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* TraderLady handoff — shown when the user's last question touches flow/sweeps/GEX/congress */}
            {messages.length >= 2 && hasFlowKeyword(messages.findLast(m => m.role === 'user')?.content ?? '') && (
                <div className="mx-4 mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-tm-gold/35 bg-tm-gold/[.06] px-4 py-3">
                    <TMMark size={22} />
                    <div className="flex-1 min-w-[200px]">
                        <p className="text-xs font-bold text-white">Intraday options flow lives on TraderMatrix.</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">ETF holdings show end-of-day positions — TraderLady sees live sweeps, blocks and GEX.</p>
                    </div>
                    <TMLink
                        placement="ask_handoff"
                        className="inline-flex min-h-11 md:min-h-0 items-center gap-1.5 rounded-xl bg-tm-gold px-4 py-2 text-xs font-extrabold text-canvas whitespace-nowrap hover:bg-tm-gold-bright transition-colors"
                    >
                        Ask TraderLady →
                    </TMLink>
                </div>
            )}

            {/* Composer */}
            <form
                onSubmit={onSubmit}
                className="px-4 py-3 border-t border-rule bg-surface-alt/30 flex gap-2"
            >
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={hasKey
                        ? "Ask about a ticker, fund, sector, or this week's moves…"
                        : `Add a ${providerMeta.label} key above to start asking…`}
                    disabled={loading || !hasKey}
                    className="flex-1 bg-canvas border border-rule rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-meta/60 focus:ring-1 focus:ring-meta/30 disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={loading || !input.trim() || !hasKey}
                    className="px-3 py-2 rounded-lg bg-meta hover:bg-meta-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    <Send className="h-4 w-4 text-canvas" />
                </button>
            </form>
        </div>
    );
}
