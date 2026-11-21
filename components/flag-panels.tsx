import { memo, useRef, type CSSProperties, type ReactNode } from "react";
import type { FlagView, Snapshot } from "@/lib/dashboard/model";
import type { StaticView } from "@/lib/dashboard/snapshot";
import { useHeightTransition } from "./use-height-transition";

const sectorList = (f: FlagView) => (f.alsoSectors.length ? `Also shown in sector ${f.alsoSectors.join(", ")}.` : "");

/** A panel that grows or shrinks smoothly when what it shows changes size. */
function AlertBox({ alert, style, label, children }: { alert: boolean; style?: CSSProperties; label?: string; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useHeightTransition(box, content);
  return (
    <section ref={box} className={alert ? "panel alert alert-box" : "panel alert-box"} style={style} aria-label={label}>
      <div ref={content} className="alert-box-body">{children}</div>
    </section>
  );
}

function FlagBody({ flag, view }: { flag: FlagView; view: StaticView }) {
  return (
    <>
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
    </>
  );
}

export const FlagPanels = memo(function FlagPanels({ view, snapshot }: { view: StaticView; snapshot: Snapshot }) {
  const sc = snapshot.safetyCar;
  const quiet = !sc && !snapshot.red && snapshot.flags.length === 0;
  return (
    <>
      {snapshot.red && (
        <AlertBox alert style={{ borderColor: "var(--red)" }}>
          <span className="badge" style={{ background: "var(--red)", color: "#fff" }}>RED FLAG</span>
          <div className="big">Session stopped</div>
        </AlertBox>
      )}
      {sc && (
        <AlertBox alert>
          <span className="badge">{sc.kind === "VSC" ? "VIRTUAL SAFETY CAR" : "SAFETY CAR"}{sc.ending ? " · ENDING" : ""}</span>
          <div className="big">Whole track under caution</div>
        </AlertBox>
      )}
      {/* Keyed by place, so "track clear" and the first flag are one box that grows into the other. */}
      {quiet ? (
        [
          <AlertBox key={0} alert={false}>
            <span className="badge outline">TRACK CLEAR</span>
            <div className="big">No active flags</div>
          </AlertBox>,
        ]
      ) : (
        snapshot.flags.map((f, i) => (
          <AlertBox key={i} alert label={`${f.flag} flag in marshal sector ${f.sector}`}>
            <FlagBody flag={f} view={view} />
          </AlertBox>
        ))
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
