import Link from "next/link";
import type { HomeData } from "@/lib/home/data";
import { formatLapTime } from "@/lib/timing/format";

export function LatestRace({ latest }: { latest: NonNullable<HomeData["latest"]> }) {
  const { meeting, summary } = latest;
  const who = (n: number) => summary.drivers.find((d) => d.number === n);
  const podium = summary.classification.filter((r) => r.position !== null).slice(0, 3);
  const fastest = summary.fastestLap ? who(summary.fastestLap.driver) : null;
  const i = summary.incidents;
  const chips = [
    i.red ? `${i.red} red flag${i.red > 1 ? "s" : ""}` : null,
    i.safetyCar ? `${i.safetyCar} safety car${i.safetyCar > 1 ? "s" : ""}` : null,
    i.vsc ? `${i.vsc} VSC` : null,
    i.doubleYellow ? `${i.doubleYellow} double yellow${i.doubleYellow > 1 ? "s" : ""}` : null,
    i.yellow ? `${i.yellow} yellow${i.yellow > 1 ? "s" : ""}` : null,
  ].filter(Boolean);

  return (
    <section className="panel recap" aria-labelledby="latest-title">
      <div className="hd">Latest race{meeting.round ? ` · Round ${meeting.round}` : ""}</div>
      <h2 id="latest-title" className="small" style={{ margin: 0 }}>{meeting.name}</h2>
      <ol className="podium">
        {podium.map((r) => {
          const d = who(r.driver);
          return (
            <li key={r.driver}>
              <span className="podium-pos">P{r.position}</span>
              <span className="bar" style={{ background: d?.colour }} />
              <span className="code" style={{ fontSize: 17 }}>{d?.name ?? d?.code}</span>
              <span className="name num">#{r.driver}</span>
              <span className="num muted" style={{ marginLeft: "auto" }}>{r.gap ?? "Winner"}</span>
            </li>
          );
        })}
      </ol>
      {fastest && summary.fastestLap && (
        <p className="note">Fastest lap: <strong style={{ color: "var(--text)" }}>{fastest.code}</strong> {formatLapTime(summary.fastestLap.seconds)} on lap {summary.fastestLap.lap}{summary.laps ? ` of ${summary.laps}` : ""}</p>
      )}
      <div className="chip-row">{chips.length ? chips.map((c) => <span key={c} className="chip">{c}</span>) : <span className="chip">No flags shown in race</span>}</div>
      <Link className="cta" href={`/session/${summary.sessionKey}`}>Watch the replay →</Link>
    </section>
  );
}
