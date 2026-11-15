import Link from "next/link";
import type { HomeData } from "@/lib/home/data";
import { SHAPE_VIEWBOX } from "@/lib/session/summary";

const SHORT: Record<string, string> = { Race: "Race", Sprint: "Sprint", Qualifying: "Quali", "Sprint Qualifying": "Sprint quali" };

const dates = (start: string, end: string) => {
  const a = new Date(start);
  const b = new Date(end);
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return month(a) === month(b) ? `${day(a)}–${day(b)} ${month(b)}` : `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
};

const WATCH: Record<string, string> = { Race: "Watch the race", Sprint: "Watch the sprint", Qualifying: "Watch qualifying", "Sprint Qualifying": "Watch sprint qualifying" };

/** The session a round's main button opens: the race once it is available, otherwise the latest session that is. */
function mainSession(m: HomeData["meetings"][number]) {
  const open = m.sessions.filter((s) => s.available);
  return open.find((s) => s.name === "Race") ?? open.at(-1) ?? null;
}

export function SeasonCalendar({ data }: { data: HomeData }) {
  const nextKey = data.next?.meeting.meetingKey;
  return (
    <section className="panel" aria-labelledby="calendar-title" id="calendar">
      <div className="split">
        <h2 id="calendar-title">{data.year} calendar</h2>
        <span className="muted" style={{ fontSize: 14 }}>{data.meetings.filter((m) => !m.cancelled).length} rounds{data.meetings.some((m) => m.cancelled) ? ` · ${data.meetings.filter((m) => m.cancelled).length} cancelled` : ""}</span>
      </div>
      <ol className="calendar">
        {data.meetings.map((m) => (
          <li key={m.meetingKey} className={`round ${m.cancelled ? "cancelled" : ""} ${m.meetingKey === nextKey ? "next" : ""}`}>
            <div className="round-head">
              <span className="round-no">{m.cancelled ? "–" : `R${m.round}`}</span>
              <span className="muted" style={{ fontSize: 13 }}>{dates(m.dateStart, m.dateEnd)}</span>
            </div>
            <div className="round-name">{m.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>{m.circuit}</div>
            {m.shape ? (
              <div className="round-figure">
                <svg className="round-track" viewBox={SHAPE_VIEWBOX} aria-hidden="true"><path d={m.shape.path} /></svg>
                {m.shape.year < new Date(m.dateStart).getUTCFullYear() && <span className="layout-note">{m.shape.year} layout</span>}
              </div>
            ) : (
              <div className="round-track placeholder" aria-hidden="true" />
            )}
            {m.cancelled ? (
              <span className="chip">Cancelled</span>
            ) : (
              <>
                {m.winner && (
                  <div className="round-winner"><span className="bar" style={{ background: m.winner.colour, height: 16 }} /> Winner <strong>{m.winner.name}</strong> #{m.winner.number}</div>
                )}
                <div className="round-foot">
                  <div className="chip-row">
                    {m.sessions.map((s) =>
                      s.available ? (
                        <Link key={s.sessionKey} href={`/session/${s.sessionKey}`} className="chip-session link" title={`Watch ${s.name}`}>
                          {SHORT[s.name] ?? s.name}
                        </Link>
                      ) : (
                        !s.upcoming && Date.parse(s.dateEnd) + 30 * 60_000 > data.now ? (
                          <Link key={s.sessionKey} href={`/live/${s.sessionKey}`} className="chip-session link live-chip" title={`${s.name}: watch live`}>
                            {SHORT[s.name] ?? s.name} · live
                          </Link>
                        ) : (
                          <span key={s.sessionKey} className="chip-session" title={s.upcoming ? `${s.name}: not run yet` : `${s.name}: results not final yet`}>{SHORT[s.name] ?? s.name}</span>
                        )
                      ),
                    )}
                  </div>
                  {(() => {
                    const main = mainSession(m);
                    if (main) {
                      return (
                        <Link href={`/session/${main.sessionKey}`} className="round-cta" aria-label={`${WATCH[main.name] ?? `Watch ${main.name}`}: ${m.name}`}>
                          <span aria-hidden="true">▶</span> {WATCH[main.name] ?? `Watch ${main.name}`}
                        </Link>
                      );
                    }
                    const upcoming = m.sessions.some((s) => s.upcoming);
                    return <span className="round-cta off">{upcoming ? "Not run yet" : "Results not final yet"}</span>;
                  })()}
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
      <p className="note">{"Each round's button opens its race; the chips open any session."}</p>
    </section>
  );
}
