import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { LiveStats } from "@/components/live-stats";
import { BottomNav } from "@/components/bottom-nav";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

// Google Analytics 4 — wired via the existing Firebase-tied GA property.
// Set NEXT_PUBLIC_GA_ID in Vercel env to the Measurement ID (G-XXXXXXXXXX).
// If unset the component renders nothing and we fall back to Vercel Analytics
// only.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TickerTrace — Institutional ETF Intelligence",
  description: "Track daily institutional ETF holdings changes. What are institutions buying today?",
  // PWA groundwork (docs/REDESIGN-PLAN.md Phase 3) — a fixed bottom bar and
  // an installable app are the same job. Icons are real PNGs generated from
  // public/icon-source.svg.html — regenerate from that file if the brand changes.
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

// viewportFit: "cover" lets the page draw under the notch/home-indicator
// area on iOS, which is what makes env(safe-area-inset-bottom) resolve to a
// real value instead of 0 — required for the fixed bottom tab bar (see
// components/bottom-nav.tsx) to clear the home-indicator on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0f1e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <BottomNav />
        <LiveStats />
        <SwRegister />
        <Analytics />
        {GA_ID && <GoogleAnalytics gaId={GA_ID} />}
      </body>
    </html>
  );
}
