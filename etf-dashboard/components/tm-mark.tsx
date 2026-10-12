import Image from 'next/image';

/** The TraderMatrix candlestick-M mark. */
export function TMMark({ size = 16, className }: { size?: number; className?: string }) {
    return <Image src="/brand/tm-mark.png" alt="" width={size} height={size} className={className} style={{ width: size, height: size, objectFit: 'contain' }} />;
}

/** "TICKER(light)TRACE(heavy)" steel wordmark with the gold endorsement line. */
export function TickerTraceLockup({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
    const s = { sm: [26, 13, 7], md: [30, 15, 8], lg: [44, 22, 11] }[size];
    return (
        <span className="inline-flex items-center gap-2.5" aria-label="TickerTrace, a TraderMatrix product">
            <TMMark size={s[0]} />
            <span className={`flex flex-col gap-[3px] ${size === 'sm' ? 'max-[359px]:hidden' : ''}`}>
                <span className="leading-none tracking-[.14em] text-tm-steel whitespace-nowrap" style={{ fontSize: s[1] }}>
                    <span className="font-light">TICKER</span><span className="font-extrabold">TRACE</span>
                </span>
                <span className={`leading-none font-semibold tracking-[.22em] text-tm-gold whitespace-nowrap ${size === 'sm' ? 'max-[419px]:hidden' : ''}`} style={{ fontSize: s[2] }}>
                    A TRADERMATRIX PRODUCT
                </span>
            </span>
        </span>
    );
}
