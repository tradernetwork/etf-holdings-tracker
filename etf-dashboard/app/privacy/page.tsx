import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
    title: 'Privacy Policy | TickerTrace',
    description: 'What TickerTrace collects, why, and what it does not.',
};

const UPDATED = 'October 11, 2026';

export default function PrivacyPage() {
    return (
        <div className="min-h-dvh bg-canvas text-foreground px-5 py-8 font-sans">
            <main className="max-w-2xl mx-auto space-y-6 leading-relaxed">
                <Link href="/" className="inline-flex items-center min-h-11 text-sm text-slate-400 hover:text-white transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" /> TickerTrace
                </Link>
                <h1 className="text-3xl font-bold">Privacy Policy</h1>
                <p className="text-sm text-slate-400">Last updated {UPDATED}. Applies to tickertrace.pro and to the TickerTrace Android app. The app is a native app (not a wrapper around the site); where the two differ, the sections below say so.</p>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">The short version</h2>
                    <p>TickerTrace is free. There are no ads, no ad networks, and no account is needed to use it. We do not sell personal data. The holdings data we show is public fund disclosure data, not information about you.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">What we collect</h2>
                    <ul className="list-disc pl-6 space-y-2 text-slate-300">
                        <li><strong>Usage analytics (website only).</strong> On tickertrace.pro we use Google Analytics 4 and Vercel Analytics to see which pages are used, what device and browser, and roughly where (country or region level). Google Analytics sets cookies or similar identifiers for this.</li>
                        <li><strong>A visitor counter.</strong> Our server counts page views for the live visitor figure. It stores a short one-way hash of your IP address, never the address itself, and deletes the records after about 30 days.</li>
                        <li><strong>Standard server logs.</strong> Our hosts (Vercel and our API server) may log IP address, user agent and request path for security and debugging.</li>
                        <li><strong>A referral code.</strong> If you arrive through a link that includes a <code>ref</code> code, we save that code in your browser&apos;s local storage so a later visit to TraderMatrix can be attributed.</li>
                    </ul>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">The Android app</h2>
                    <p>The app has no ads, no ad networks and no analytics or tracking libraries, and it does not ask for your location, contacts, camera, microphone or advertising ID. Your follows (the funds and stocks you star), your theme and category choices and your notification setting are stored on your phone. The app reads public data from our API. To deliver app updates, the app contacts Expo&apos;s update service, which receives the app version, platform and a random per-install identifier, plus your IP address as part of the request.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Notifications (optional)</h2>
                    <p>Daily digest notifications are optional and off until you turn them on in the app and allow the Android notification permission. If you do, the app registers your phone with our server: a random device identifier, your Expo push token, a hashed access secret, and the list of funds and stocks you follow. We use this only to send you the digest you asked for. We store no name, email address, phone number, advertising ID, location or portfolio, and we do not use this registry for advertising or analytics.</p>
                    <p>Messages are delivered through Expo&apos;s push service and Google&apos;s Firebase Cloud Messaging, which process your push token to deliver them. A digest that has not been sent within 24 hours is dropped, and digest records are deleted after 30 days. A registration is deleted after 180 days without use (a digest delivered to your phone counts as use).</p>
                    <p>To delete it yourself, turn notifications off or choose &ldquo;Clear my follows&rdquo; in the app&apos;s Settings. While your phone is online, that asks our server to erase your device record, follows and digest records right away; if the phone is offline the request cannot be sent, so repeat it once you are back online. We keep a one-way hash of your push token and a count of sign-ups, only to limit abuse; it contains no follows and is removed shortly after the end of that UTC day. We cannot look up a registration from a name or email address because we hold neither, so deletion has to come from the app; if you have uninstalled it, the registration expires as described above. We do not run our own backups of this registry; if our hosting provider takes server-level snapshots, a deleted record can persist in them until they rotate out. Questions: <a className="text-equity underline" href="mailto:admin@tradermatrix.pro">admin@tradermatrix.pro</a>.</p>
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
                    <p className="text-slate-300">You can block analytics with your browser or a content blocker, clear local storage at any time, and ask us questions about your data. Email <a className="text-equity underline" href="mailto:admin@tradermatrix.pro">admin@tradermatrix.pro</a>.</p>
                </section>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold">Changes</h2>
                    <p className="text-slate-300">If this policy changes, we will update the date above.</p>
                </section>
            </main>
        </div>
    );
}
