/**
 * OG share card for /stocks/[ticker].
 * Served at /stocks/NVDA/opengraph-image by Next.js App Router file convention.
 * 1200×630 · Node.js runtime (needs fs for the brand asset).
 *
 * Design: TT Channels.dc.html § "OG share card"
 *  - Radial navy background
 *  - TMMark + steel wordmark + gold endorsement line (top-left)
 *  - Huge cyan ticker (center)
 *  - "{n} funds holding · +Δ% today" from REAL API data (falls back to plain
 *    brand card with just the ticker when the API is unavailable)
 *  - Bottom: tickertrace.pro/stocks/TICKER | Live flow → tradermatrix.pro
 */
import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';
import { api } from '@/lib/api';

export const runtime = 'nodejs';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Read the TMMark PNG once at request time and encode as a data URL. */
function tmMarkDataUrl(): string {
    try {
        const buf = readFileSync(join(process.cwd(), 'public', 'brand', 'tm-mark.png'));
        return `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
        return '';
    }
}

export default async function OGImage({ params }: { params: Promise<{ ticker: string }> }) {
    const { ticker: raw } = await params;
    const ticker = decodeURIComponent(raw).toUpperCase();

    // Attempt to get real data — fall back gracefully when unavailable.
    let fundCount = 0;
    let netChange = 0;
    let streakDays: number | null = null;
    let distinctFamilies = 0;

    try {
        const detail = await api.stock(ticker);
        if (detail) {
            fundCount = detail.fundCount;
            netChange = detail.institutional.daily;
            streakDays = detail.institutional.streak ?? null;
            distinctFamilies = new Set(
                detail.holdings.filter(h => !h.isOption).map(h => h.provider)
            ).size;
        }
    } catch {
        // API unavailable — brand fallback used below
    }

    const markSrc = tmMarkDataUrl();
    const hasFundData = fundCount > 0;

    const changeSign = netChange > 0 ? '+' : '';
    const changeFmt = `${changeSign}${netChange.toFixed(3)}%`;
    const changeColor = netChange > 0 ? '#00ff88' : netChange < 0 ? '#ff4444' : '#94a3b8';

    return new ImageResponse(
        (
            <div
                style={{
                    width: 1200,
                    height: 630,
                    background: 'radial-gradient(120% 90% at 85% 10%, #16203a 0%, #0a0f1e 60%)',
                    color: '#fafafa',
                    fontFamily: 'system-ui, sans-serif',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '64px 72px',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                {/* Top: TMMark + wordmark */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {markSrc && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={markSrc} alt="" width={64} height={64} style={{ objectFit: 'contain' }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 30, lineHeight: '1', letterSpacing: '0.14em', color: '#c8d8ec', display: 'flex' }}>
                            <span style={{ fontWeight: 300 }}>TICKER</span>
                            <span style={{ fontWeight: 800 }}>TRACE</span>
                        </span>
                        <span style={{ fontSize: 14, lineHeight: '1', fontWeight: 600, letterSpacing: '0.24em', color: '#e0b03a' }}>
                            A TRADERMATRIX PRODUCT
                        </span>
                    </div>
                </div>

                {/* Center: ticker + stats */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{
                        fontFamily: 'monospace',
                        fontSize: 120,
                        lineHeight: '1',
                        fontWeight: 900,
                        color: '#00d4ff',
                        letterSpacing: '-0.02em',
                    }}>
                        {ticker}
                    </div>
                    {hasFundData ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{
                                fontSize: 52,
                                lineHeight: '1.1',
                                fontWeight: 800,
                                color: '#ffffff',
                                marginTop: 12,
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0 8px',
                                alignItems: 'baseline',
                            }}>
                                <span>{`${fundCount} funds holding · `}</span>
                                <span style={{ color: changeColor }}>{`${changeFmt} today`}</span>
                            </div>
                            {(streakDays != null && Math.abs(streakDays) >= 2) || distinctFamilies > 1 ? (
                                <div style={{ fontSize: 30, color: '#94a3b8', marginTop: 12 }}>
                                    {[
                                        streakDays != null && Math.abs(streakDays) >= 2
                                            ? `${Math.abs(streakDays)}-day institutional ${streakDays > 0 ? 'buying' : 'selling'} streak`
                                            : '',
                                        distinctFamilies > 1 ? `${distinctFamilies} fund families` : '',
                                    ].filter(Boolean).join(' · ')}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div style={{ fontSize: 42, color: '#94a3b8', marginTop: 12, fontWeight: 600 }}>
                            Institutional ETF holdings tracker
                        </div>
                    )}
                </div>

                {/* Bottom bar */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 24,
                    color: '#64748b',
                }}>
                    <span>{`tickertrace.pro/stocks/${ticker}`}</span>
                    <span style={{ color: '#f2c95c', fontWeight: 700 }}>Live flow → tradermatrix.pro</span>
                </div>
            </div>
        ),
        {
            ...size,
        }
    );
}
