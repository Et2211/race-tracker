import { memo } from "react";
import type { FlagView, Snapshot } from "@/lib/dashboard/model";
import type { StaticView } from "@/lib/dashboard/snapshot";

const sectorList = (f: FlagView) => (f.alsoSectors.length ? `Also shown in sector ${f.alsoSectors.join(", ")}.` : "");

function FlagPanel({ flag, view }: { flag: FlagView; view: StaticView }) {
  return (
    <section className="panel alert" aria-label={`${flag.flag} flag in marshal sector ${flag.sector}`}>
      <div className="split" style={{ alignItems: "center" }}>
        <span className="badge">{flag.flag}</span>
        <span className="muted" style={{ fontSize: 14 }}>Raised {flag.raisedAt} UTC{flag.lap ? ` · Lap ${flag.lap}${view.totalLaps ? ` / ${view.totalLaps}` : ""}` : ""}</span>
      </div>
      <div>
        <div className="big">Marshal sector {flag.sector}</div>
        {(!flag.placement.known || flag.alsoSectors.length > 0) && (
          <p className="note" style={{ marginTop: 4 }}>
            {[flag.placement.known ? "" : "Not shown on the map.", sectorList(flag)].filter(Boolean).join(" ")}
          </p>
        )}
        {flag.staleMinutes !== null && (
          <p className="note" style={{ color: "var(--yellow)", marginTop: 4 }}>No all-clear for {flag.staleMinutes} minutes: this flag may already be over.</p>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="hd">Possibly involved</div>
        {!flag.inferred ? (
          <div className="inset">
            <div style={{ fontSize: 16, fontWeight: 600 }}>Not checked yet</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 4, lineHeight: 1.45 }}>{flag.confidenceNote}</div>
          </div>
        ) : flag.stopped.length === 0 ? (
          <div className="inset">
            <div style={{ fontSize: 16, fontWeight: 600 }}>No stopped car found</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 4, lineHeight: 1.45 }}>{flag.confidenceNote}</div>
          </div>
        ) : (
          flag.stopped.map((car) => {
            const d = view.drivers[car.driver];
            return (
              <div key={car.driver} className="car-card">
                <div className="car-head">
                  <span className="bar" style={{ background: d?.colour }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="code">#{car.driver} {d?.code}</span> <span className="name">{d?.name}</span>
                  </div>
                  <span className="tagline" style={car.role === "first" || car.role === "stopped" ? undefined : { color: "var(--muted)" }}>
                    {{ first: "STOPPED FIRST", stopped: "STOPPED", elsewhere: "STOPPED ELSEWHERE", contact: "POSSIBLE CONTACT", named: "NAMED BY RACE CONTROL" }[car.role]}
                  </span>
                </div>
                {car.evidence.map((line) => <div key={line} className="ev">{line}</div>)}
              </div>
            );
          })
        )}
        <div className="confidence">
          {flag.inferred && <span className={`chip ${flag.confidence}`}>CONFIDENCE: {flag.confidence.toUpperCase()}</span>}
          {flag.stopped.length > 0 && <span className="note" style={{ flex: "1 1 200px" }}>{flag.confidenceNote}</span>}
        </div>
      </div>
      <p className="note">Estimated from car data, not from the stewards. Says who stopped, not who was at fault.</p>
    </section>
  );
}

export const FlagPanels = memo(function FlagPanels({ view, snapshot }: { view: StaticView; snapshot: Snapshot }) {
  const sc = snapshot.safetyCar;
  const quiet = !sc && !snapshot.red && snapshot.flags.length === 0;
  return (
    <>
      {snapshot.red && (
        <section className="panel alert" style={{ borderColor: "var(--red)" }}>
          <span className="badge" style={{ background: "var(--red)", color: "#fff" }}>RED FLAG</span>
          <div className="big">Session stopped</div>
        </section>
      )}
      {sc && (
        <section className="panel alert">
          <span className="badge">{sc.kind === "VSC" ? "VIRTUAL SAFETY CAR" : "SAFETY CAR"}{sc.ending ? " · ENDING" : ""}</span>
          <div className="big">Whole track under caution</div>
        </section>
      )}
      {snapshot.flags.map((f) => <FlagPanel key={f.sector} flag={f} view={view} />)}
      {quiet && (
        <section className="panel">
          <span className="badge outline">TRACK CLEAR</span>
          <div className="big">No active flags</div>
        </section>
      )}
      <section className="panel" style={{ flex: 1 }}>
        <div className="split">
          <h2 className="small" id="rc-title">Race control</h2>
          {snapshot.log.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{snapshot.log.length} message{snapshot.log.length === 1 ? "" : "s"} · newest first · UTC</span>}
        </div>
        {snapshot.log.length === 0 && <p className="note">No messages yet.</p>}
        <ul className="log log-scroll" tabIndex={0} aria-labelledby="rc-title">
          {snapshot.log.map((entry) => (
            <li key={entry.id}>
              <span className="when">
                {entry.pre ? "Pre" : entry.lap ? `L${entry.lap}` : null}
                <time className="when-time" dateTime={entry.iso}>{entry.time}</time>
              </span>
              <span className={`tone-${entry.tone}`}>{entry.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
});
