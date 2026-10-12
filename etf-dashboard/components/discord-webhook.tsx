'use client';

import { useState, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2, Bookmark, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const STORAGE_KEY = 'tt_discord_webhook';

// Matches the ApiSignal shape from lib/api.ts (review #10).
// `funds` is now a plain string[] of fund tickers; per-fund details live on
// `fundDetails` if needed. We only need the names for the webhook embed.
interface DiscordSignal {
    ticker: string;
    totalWeightDelta: number;
    fundCount: number;
    funds: string[];
}

interface SectorFlow {
    sector: string;
    weightDelta: number;
}

interface DiscordWebhookProps {
    buyingSignals: DiscordSignal[];
    sellingSignals: DiscordSignal[];
    sectorFlow: SectorFlow[];
    asOfDate: string;
}

type Status = 'idle' | 'sending' | 'sent' | 'error';

function buildEmbed(props: DiscordWebhookProps) {
    const { buyingSignals, sellingSignals, sectorFlow, asOfDate } = props;

    const formatSignals = (signals: DiscordSignal[]) =>
        signals
            .slice(0, 5)
            .map(s => {
                const funds = s.funds.join(', ');
                const delta = s.totalWeightDelta > 0 ? `+${s.totalWeightDelta.toFixed(2)}%` : `${s.totalWeightDelta.toFixed(2)}%`;
                const multi = s.fundCount > 1 ? ` (${s.fundCount} funds)` : '';
                return `**${s.ticker}** ${delta}${multi} — ${funds}`;
            })
            .join('\n') || '_No significant signals_';

    const formatSectors = (flows: SectorFlow[]) => {
        const inflows = flows.filter(f => f.weightDelta > 0).slice(0, 3);
        const outflows = flows.filter(f => f.weightDelta < 0).slice(0, 3);
        const parts: string[] = [];
        if (inflows.length) parts.push('▲ ' + inflows.map(f => `${f.sector} +${f.weightDelta.toFixed(2)}%`).join(' | '));
        if (outflows.length) parts.push('▼ ' + outflows.map(f => `${f.sector} ${f.weightDelta.toFixed(2)}%`).join(' | '));
        return parts.join('\n') || '_No sector movement_';
    };

    return {
        username: 'TickerTrace',
        avatar_url: 'https://tickertrace.pro/favicon.ico',
        embeds: [
            {
                title: '🎯 TickerTrace Daily Intel',
                url: 'https://tickertrace.pro/dashboard',
                color: 0x00d4ff,
                description: `Institutional activity as of **${asOfDate}**`,
                fields: [
                    {
                        name: '📈 Institutions Are Buying',
                        value: formatSignals(buyingSignals),
                        inline: false,
                    },
                    {
                        name: '📉 Institutions Are Selling',
                        value: formatSignals(sellingSignals),
                        inline: false,
                    },
                    {
                        name: '📊 Sector Flow',
                        value: formatSectors(sectorFlow),
                        inline: false,
                    },
                ],
                footer: {
                    text: 'TickerTrace · A TraderMatrix product · tickertrace.pro',
                },
                timestamp: new Date().toISOString(),
            },
        ],
    };
}

export function DiscordWebhook(props: DiscordWebhookProps) {
    const [webhookUrl, setWebhookUrl] = useState('');
    const [savedUrl, setSavedUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState(false);

    // Load saved webhook from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            setSavedUrl(saved);
            setWebhookUrl(saved);
        }
    }, []);

    const handleSave = () => {
        if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) return;
        localStorage.setItem(STORAGE_KEY, webhookUrl);
        setSavedUrl(webhookUrl);
    };

    const handleForget = () => {
        localStorage.removeItem(STORAGE_KEY);
        setSavedUrl(null);
        setWebhookUrl('');
    };

    const handleSend = async () => {
        if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
            setError('Must be a valid Discord webhook URL');
            setStatus('error');
            return;
        }

        setStatus('sending');
        setError('');

        try {
            const payload = buildEmbed(props);
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                throw new Error(`Discord returned ${res.status}: ${await res.text()}`);
            }

            // Auto-save on successful send
            localStorage.setItem(STORAGE_KEY, webhookUrl);
            setSavedUrl(webhookUrl);

            setStatus('sent');
            setTimeout(() => setStatus('idle'), 5000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            setStatus('error');
        }
    };

    const isSaved = savedUrl === webhookUrl && !!webhookUrl;

    return (
        <div className="bg-surface border border-rule rounded-xl overflow-hidden shrink-0">
            {/* Toggle header */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-hover transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="text-lg">💬</span>
                    <span className="text-sm font-semibold text-slate-300">Send to Discord</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-[#5865F2] border-[#5865F2]/30 bg-[#5865F2]/10">
                        Webhook
                    </Badge>
                    {savedUrl && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-buy border-buy/30 bg-buy/10">
                            saved
                        </Badge>
                    )}
                </div>
                <span className="text-slate-500 text-xs">{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-rule">
                    <p className="text-xs text-slate-500">
                        Paste your Discord webhook URL — it&apos;s saved in your browser so you only need to do this once.
                    </p>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={webhookUrl}
                            onChange={e => setWebhookUrl(e.target.value)}
                            placeholder="https://discord.com/api/webhooks/..."
                            className="flex-1 bg-surface-alt border border-surface-elevated rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-[#5865F2]/50 transition-colors min-w-0"
                        />
                        {/* Save button (only when URL changed from saved) */}
                        {webhookUrl && !isSaved && webhookUrl.startsWith('https://discord.com/api/webhooks/') && (
                            <button
                                onClick={handleSave}
                                title="Save webhook URL"
                                className="flex items-center gap-1 px-3 py-2 bg-surface-elevated text-slate-300 text-xs font-semibold rounded-lg hover:bg-rule-strong transition-colors"
                            >
                                <Bookmark className="h-3.5 w-3.5" />
                            </button>
                        )}
                        {/* Forget button */}
                        {savedUrl && (
                            <button
                                onClick={handleForget}
                                title="Forget saved webhook"
                                className="flex items-center gap-1 px-3 py-2 bg-surface-elevated text-sell text-xs font-semibold rounded-lg hover:bg-[#2a1a1a] transition-colors"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        )}
                        <button
                            onClick={handleSend}
                            disabled={status === 'sending' || !webhookUrl}
                            className="flex items-center gap-1.5 px-4 py-2 bg-[#5865F2] text-white text-xs font-semibold rounded-lg hover:bg-[#4752c4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                        >
                            {status === 'sending' ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending</>
                            ) : (
                                <><Send className="h-3.5 w-3.5" /> Send</>
                            )}
                        </button>
                    </div>

                    {isSaved && (
                        <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <Bookmark className="h-3 w-3 text-buy" /> Webhook saved to your browser
                        </p>
                    )}
                    {status === 'sent' && (
                        <p className="flex items-center gap-1.5 text-xs text-buy">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Sent! Check your Discord channel.
                        </p>
                    )}
                    {status === 'error' && (
                        <p className="flex items-center gap-1.5 text-xs text-sell">
                            <AlertCircle className="h-3.5 w-3.5" /> {error}
                        </p>
                    )}

                    {/* Embed Preview */}
                    <EmbedPreview {...props} />
                </div>
            )}
        </div>
    );
}

function EmbedPreview(props: DiscordWebhookProps) {
    const { buyingSignals, sellingSignals, sectorFlow, asOfDate } = props;

    const topBuys = buyingSignals.slice(0, 5);
    const topSells = sellingSignals.slice(0, 5);
    const inflows = sectorFlow.filter(f => f.weightDelta > 0).slice(0, 3);
    const outflows = sectorFlow.filter(f => f.weightDelta < 0).slice(0, 3);

    return (
        <div className="mt-2">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5 font-semibold">Preview</p>
            {/* Discord-style embed card */}
            <div className="bg-[#2f3136] rounded border-l-4 border-l-[#e0b03a] p-3 space-y-2.5 text-[11px]">
                {/* Title */}
                <div>
                    <a className="text-equity font-bold text-xs hover:underline cursor-pointer">🎯 TickerTrace Daily Intel</a>
                    <p className="text-slate-400 text-[10px] mt-0.5">Institutional activity as of <strong className="text-slate-300">{asOfDate}</strong></p>
                </div>

                {/* Fields */}
                <div className="space-y-2">
                    {/* Buying */}
                    <div>
                        <p className="text-slate-300 font-bold text-[10px]">📈 Institutions Are Buying</p>
                        {topBuys.length === 0 ? (
                            <p className="text-slate-500 italic">No significant signals</p>
                        ) : topBuys.map(s => (
                            <p key={s.ticker} className="text-slate-400">
                                <strong className="text-white">{s.ticker}</strong>{' '}
                                <span className="text-buy">+{s.totalWeightDelta.toFixed(2)}%</span>
                                {s.fundCount > 1 && <span className="text-slate-500"> ({s.fundCount} funds)</span>}
                                <span className="text-slate-600"> — {s.funds.join(', ')}</span>
                            </p>
                        ))}
                    </div>

                    {/* Selling */}
                    <div>
                        <p className="text-slate-300 font-bold text-[10px]">📉 Institutions Are Selling</p>
                        {topSells.length === 0 ? (
                            <p className="text-slate-500 italic">No significant signals</p>
                        ) : topSells.map(s => (
                            <p key={s.ticker} className="text-slate-400">
                                <strong className="text-white">{s.ticker}</strong>{' '}
                                <span className="text-sell">{s.totalWeightDelta.toFixed(2)}%</span>
                                <span className="text-slate-600"> — {s.funds.join(', ')}</span>
                            </p>
                        ))}
                    </div>

                    {/* Sectors */}
                    <div>
                        <p className="text-slate-300 font-bold text-[10px]">📊 Sector Flow</p>
                        {inflows.length > 0 && (
                            <p className="text-slate-400">▲ {inflows.map(f => `${f.sector} +${f.weightDelta.toFixed(2)}%`).join(' | ')}</p>
                        )}
                        {outflows.length > 0 && (
                            <p className="text-slate-400">▼ {outflows.map(f => `${f.sector} ${f.weightDelta.toFixed(2)}%`).join(' | ')}</p>
                        )}
                        {inflows.length === 0 && outflows.length === 0 && (
                            <p className="text-slate-500 italic">No sector movement</p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 border-t border-[#40444b] pt-2">
                    <span>TickerTrace · A TraderMatrix product · tickertrace.pro</span>
                </div>
            </div>
        </div>
    );
}
