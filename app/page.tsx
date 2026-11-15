import Link from "next/link";
import { SessionPicker } from "@/components/session-picker";

const REFERENCE = [
  { key: 11369, label: "2026 Spanish Grand Prix · Race", note: "New street circuit; yellow for a stopped car, VSC with a double yellow" },
  { key: 11365, label: "2026 Spanish Grand Prix · Qualifying", note: "Weather-hit Q3" },
  { key: 11412, label: "2026 São Paulo Grand Prix · Race", note: "Mixed weather; three cars spun at flagged corners" },
  { key: 11408, label: "2026 São Paulo Grand Prix · Qualifying", note: "Two red flags; Q2 never resumed" },
];

export default function Home() {
  return (
    <div className="page">
      <header className="masthead">
        <div>
          <div className="hd" style={{ color: "var(--red-text)" }}>Race weekend dashboard</div>
          <h1>Choose a session</h1>
          <p>Replay any race, sprint or qualifying session from 2023 onwards. A session is downloaded from OpenF1 the first time it is opened, then kept.</p>
        </div>
      </header>
      <main style={{ display: "contents" }}>
      <div className="toolbar">
        <SessionPicker label="Season · Grand Prix · Session" />
      </div>
      <section className="panel">
        <h2 className="small">Reference sessions</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {REFERENCE.map((r) => (
            <li key={r.key}>
              <Link href={`/session/${r.key}`} style={{ color: "var(--text)", fontWeight: 600 }}>{r.label}</Link>
              <span className="muted" style={{ fontSize: 14 }}> · {r.note}</span>
            </li>
          ))}
        </ul>
      </section>
      </main>
      <footer className="footer">Data: OpenF1, an unofficial project not affiliated with Formula 1. Personal, non-commercial use.</footer>
    </div>
  );
}
