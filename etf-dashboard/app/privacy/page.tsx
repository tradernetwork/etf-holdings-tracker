import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
    title: 'Privacy Policy | TickerTrace',
    description: 'What TickerTrace collects, why, and what it does not.',
};

const UPDATED = 'October 8, 2026';

export default function PrivacyPage() {
    return (
        <div className="min-h-dvh bg-canvas text-foreground px-5 py-8 font-sans">
            <main className="max-w-2xl mx-auto space-y-6 leading-relaxed">
                <Link href="/" className="inline-flex items-center min-h-11 text-sm text-slate-400 hover:text-white transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" /> TickerTrace
                </Link>
                <h1 className="text-3xl font-bold">Privacy Policy</h1>
                <p className="text-sm text-slate-400">Last updated {UPDATED}. Applies to tickertrace.pro and the TickerTrace Android app, which is the same site in a wrapper.</p>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">The short version</h2>
                    <p>TickerTrace is free. There are no ads, no ad networks, and no account is needed to use it. We do not sell personal data. The holdings data we show is public fund disclosure data, not information about you.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">What we collect</h2>
                    <ul className="list-disc pl-6 space-y-2 text-slate-300">
                        <li><strong>Usage analytics.</strong> We use Google Analytics 4 and Vercel Analytics to see which pages are used, what device and browser, and roughly where (country or region level). Google Analytics sets cookies or similar identifiers for this.</li>
                        <li><strong>A visitor counter.</strong> Our server counts page views for the live visitor figure. It stores a short one-way hash of your IP address, never the address itself, and deletes the records after about 30 days.</li>
                        <li><strong>Standard server logs.</strong> Our hosts (Vercel and our API server) may log IP address, user agent and request path for security and debugging.</li>
                        <li><strong>A referral code.</strong> If you arrive through a link that includes a <code>ref</code> code, we save that code in your browser&apos;s local storage so a later visit to TraderMatrix can be attributed.</li>
                    </ul>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Things you can choose to enter</h2>
                    <ul className="list-disc pl-6 space-y-2 text-slate-300">
                        <li><strong>AI provider keys (Ask TickerTrace).</strong> If you paste your own API key for an AI provider, it is stored only in your browser. Your questions go from your browser to that provider under their terms. They do not pass through our servers.</li>
                        <li><strong>Discord webhook.</strong> If you add a webhook URL to post changes to your own server, it is stored only in your browser and used to send messages directly to Discord.</li>
                    </ul>
                    <p className="text-slate-300">Clearing your browser or app storage removes both.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Accounts</h2>
                    <p className="text-slate-300">The dashboard and the public API need no account. If you register for an API key, we store the email address you provide and a hashed password, and use them only to run that account.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Links to TraderMatrix and others</h2>
                    <p className="text-slate-300">TickerTrace is part of the TraderMatrix network and links to tradermatrix.pro, sometimes with a referral code, which may earn us a commission at no cost to you. Other sites you reach through links have their own policies. Share buttons for X, Reddit and LinkedIn only open when you tap them.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Not financial advice</h2>
                    <p className="text-slate-300">TickerTrace reports what funds disclose. It is information, not investment advice or a recommendation to buy or sell anything.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Children</h2>
                    <p className="text-slate-300">TickerTrace is not directed to children under 13 and we do not knowingly collect their information.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Your choices</h2>
                    <p className="text-slate-300">You can block analytics with your browser or a content blocker, clear local storage at any time, and ask us to delete any account data we hold. Email <a className="text-equity underline" href="mailto:admin@tradermatrix.pro">admin@tradermatrix.pro</a>.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Changes</h2>
                    <p className="text-slate-300">If this policy changes, we will update the date above.</p>
                </section>
            </main>
        </div>
    );
}
