import type { StaticView } from "@/lib/dashboard/snapshot";
import type { Lap } from "@/lib/openf1/types";
import type { Pass } from "@/lib/driver/passes";
import { lapAt, type DriverSummary } from "@/lib/driver/summary";
import type { SessionKind } from "@/lib/session/types";
import { formatClock, formatLapTime } from "@/lib/timing/format";

const COMPOUND: Record<string, string> = { SOFT: "Softs", MEDIUM: "Mediums", HARD: "Hards", INTERMEDIATE: "Inters", WET: "Wets" };
const compound = (c: string | null) => (c ? (COMPOUND[c] ?? c) : "?");
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset tile">
      <div className="hd">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="note">{sub}</div>}
    </div>
  );
}

function placesLine(made: Pass[], lost: Pass[], kind: Pass["kind"]): { gained: number; lost: number } {
  return { gained: made.filter((p) => p.kind === kind).length, lost: lost.filter((p) => p.kind === kind).length };
}

export function SummaryTab({ summary, driver, view, laps, kind, live }: { summary: DriverSummary; driver: number; view: StaticView; laps: Lap[]; kind: SessionKind; live: boolean }) {
  const s = summary;
  const race = kind === "race";
  const code = (n: number) => view.drivers[n]?.code ?? `#${n}`;
  const change = s.grid !== null && s.position !== null ? s.grid - s.position : null;
  const track = placesLine(s.passes.made, s.passes.lost, "track");
  const pit = placesLine(s.passes.made, s.passes.lost, "pit");
  const retire = placesLine(s.passes.made, s.passes.lost, "retirement");
  const recent = [...s.passes.made.map((p) => ({ p, gained: true })), ...s.passes.lost.map((p) => ({ p, gained: false }))].sort((a, b) => b.p.t - a.p.t).slice(0, 8);

  return (
    <div className="driver-tab">
      <div className="tiles">
        {s.position !== null && (
          <Tile
            label="Position"
            value={`P${s.position}`}
            sub={race && s.grid !== null ? (change === 0 ? `Started P${s.grid}` : `Started P${s.grid}, ${change! > 0 ? `${change} up` : `${-change!} down`}`) : undefined}
          />
        )}
        <Tile label="Laps" value={String(s.lapsDone)} sub={s.deletedLaps ? `${plural(s.deletedLaps, "lap time")} deleted` : undefined} />
        <Tile label="Best lap" value={s.bestLap ? formatLapTime(s.bestLap.time) : "–"} sub={s.bestLap ? `Lap ${s.bestLap.lap}` : "No timed lap yet"} />
        <Tile label="Speed trap" value={s.trap ? `${s.trap.speed} km/h` : "–"} sub={s.trap ? `Lap ${s.trap.lap} · ${s.trap.rank === 1 ? "fastest" : `${ordinal(s.trap.rank)} fastest`} of ${s.trap.of}` : "No reading yet"} />
        {s.tyre && <Tile label="Tyres" value={compound(s.tyre.compound)} sub={`${s.tyre.age === null ? "Age not known" : `${plural(s.tyre.age, "lap")} old`} · ${plural(s.tyre.stops, "stop")}`} />}
      </div>

      {race && (
        <div className="driver-cols">
          <div className="inset">
            <div className="hd">Places gained and lost</div>
            <table className="mini">
              <caption className="sr-only">Places gained and lost by cause</caption>
              <thead>
                <tr>
                  <th scope="col" className="left">How</th>
                  <th scope="col">Gained</th>
                  <th scope="col">Lost</th>
                </tr>
              </thead>
              <tbody>
                <tr><th scope="row" className="left">Passes on track</th><td className="num">{track.gained}</td><td className="num">{track.lost}</td></tr>
                <tr><th scope="row" className="left">Around pit stops</th><td className="num">{pit.gained}</td><td className="num">{pit.lost}</td></tr>
                <tr><th scope="row" className="left">Cars retiring</th><td className="num">{retire.gained}</td><td className="num">{retire.lost}</td></tr>
              </tbody>
            </table>
            {recent.length > 0 && (
              <ul className="event-list">
                {recent.map(({ p, gained }) => (
                  <li key={`${p.t}-${p.by}-${p.of}`}>
                    <span className="when">L{lapAt(laps, driver, p.t) ?? "?"}</span>
                    <span>
                      {gained ? `Passed ${code(p.of)}` : `Passed by ${code(p.by)}`}
                      {p.kind === "pit" ? " around a pit stop" : p.kind === "retirement" ? " (retiring)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="note" style={{ marginTop: 8 }}>
              From the position feed: a pass is a change of order between two cars. Within a minute of either car&apos;s pit stop it counts as the stop.
            </p>
          </div>

          <div className="inset">
            <div className="hd">Pit stops</div>
            {s.pitStops.length === 0 ? (
              <p className="note" style={{ marginTop: 6 }}>No stops yet.</p>
            ) : (
              <table className="mini">
                <caption className="sr-only">Pit stops</caption>
                <thead>
                  <tr>
                    <th scope="col" className="left">Lap</th>
                    <th scope="col" className="left">Tyres</th>
                    <th scope="col">Pit lane</th>
                    <th scope="col">Stationary</th>
                  </tr>
                </thead>
                <tbody>
                  {s.pitStops.map((p) => (
                    <tr key={p.t}>
                      <td className="num left">{p.lap}</td>
                      <td className="left">{compound(p.from)} → {p.to ? compound(p.to) : "?"}</td>
                      <td className="num">{p.lane !== null ? `${p.lane.toFixed(1)} s` : "–"}</td>
                      <td className="num">{p.stationary !== null ? `${p.stationary.toFixed(1)} s` : live ? "not published yet" : "not recorded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <div className="inset">
        <div className="hd">Race control about this driver</div>
        {s.messages.length === 0 ? (
          <p className="note" style={{ marginTop: 6 }}>No messages yet.</p>
        ) : (
          <ul className="event-list">
            {s.messages.map((m) => (
              <li key={`${m.t}-${m.text}`}>
                <span className="when">{m.lap ? `L${m.lap}` : formatClock(m.t)}</span>
                <span>
                  {m.kind !== "other" && <span className={`chip kind-${m.kind.replace(" ", "-")}`}>{m.kind.toUpperCase()}</span>} {m.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
