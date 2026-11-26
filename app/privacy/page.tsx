import type { Metadata } from "next";
import Link from "next/link";
import { REPORT_URL } from "@/components/site-links";

export const metadata: Metadata = { title: "Privacy · Speed Trace" };

export default function Privacy() {
  return (
    <div className="page">
      <header className="masthead">
        <div>
          <Link href="/" className="back">← All sessions</Link>
          <div className="hd" style={{ color: "var(--red-text)" }}><Link href="/" className="home-link">Speed Trace</Link></div>
          <h1>Privacy</h1>
        </div>
      </header>
      <main className="page-main">
        <section className="panel prose">
          <p>Speed Trace is an unofficial fan site. It has no accounts and asks you for nothing.</p>
          <h2>What is collected</h2>
          <ul>
            <li>
              <strong>Visits and page speed.</strong> Vercel Web Analytics and Speed Insights count page views and measure how fast pages load. They set no cookies and keep no
              personal profile; Vercel counts visitors with a hash that changes every day.
            </li>
            <li>
              <strong>Server logs.</strong> Vercel, which hosts the site, keeps short-lived request logs (addresses, pages asked for, errors) to run it and keep it secure.
            </li>
          </ul>
          <h2>What isn&apos;t</h2>
          <ul>
            <li>No cookies, no advertising, no tracking across other sites.</li>
            <li>Nothing is sold or shared beyond the hosting above.</li>
          </ul>
          <h2>The data shown</h2>
          <p>Timing and car data come from OpenF1 and circuit details from MultiViewer. Speed Trace is not affiliated with Formula 1, the FIA, OpenF1 or MultiViewer.</p>
          <h2>Questions</h2>
          <p>
            <a href={REPORT_URL} target="_blank" rel="noopener noreferrer">Open an issue on GitHub</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
