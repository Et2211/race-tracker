import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, JetBrains_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlowCondensed = Barlow_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin"], weight: ["500", "600", "700"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], weight: ["500", "600"] });

const NAME = "Speed Trace";
const DESCRIPTION = "Formula 1 sessions live and replayed: track map, timing, gaps, flags and driver telemetry. An unofficial fan site.";

export const metadata: Metadata = {
  title: NAME,
  description: DESCRIPTION,
  applicationName: NAME,
  // What a shared link shows (X, messaging apps).
  openGraph: { siteName: NAME, title: NAME, description: DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: NAME, description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} ${jetbrainsMono.variable}`}>
      <body>
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
