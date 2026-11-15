"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildSnapshot, buildStatic } from "@/lib/dashboard/snapshot";
import type { CarDot } from "@/lib/dashboard/model";
import { SPEEDS, useClock, useThrottled, type Speed } from "@/lib/replay/use-clock";
import { useSession } from "@/lib/replay/use-session";
import { jumpTargets } from "@/lib/replay/timeline";
import { traceAt } from "@/lib/session/telemetry";
import { formatClock, formatLapTime, formatSector } from "@/lib/timing/format";
import type { Phase } from "@/lib/timing/qualifying";
import { toMap } from "@/lib/track/map";
import { FlagPanels } from "./flag-panels";
import { GapChart } from "./gap-chart";
import { SessionPicker } from "./session-picker";
import { MarkLegend, QualifyingTable, RaceTable } from "./timing-tables";
import { MapLegend, TrackMap } from "./track-map";

export function SessionDashboard({ sessionKey, initialTime }: { sessionKey: number; initialTime: number | null }) {
  const [playhead, setPlayhead] = useState<number | null>(initialTime);
  const loader = useSession(sessionKey, playhead);
  const { meta } = loader;

  if (!meta) {
    return (
      <div className="page">
        <main style={{ display: "contents" }}>
        <div className="toolbar"><SessionPicker label="Choose a session" /></div>
        <section className="panel" aria-live="polite">
          {loader.state.phase === "error" ? (
            <>
              <h2>Could not load this session</h2>
              <p className="note" role="alert">{loader.state.message}</p>
              <button className="tab" style={{ alignSelf: "flex-start" }} onClick={loader.retry}>Try again</button>
            </>
          ) : (
            <>
              <h2>Loading session {sessionKey}</h2>
              <p className="note">{loader.state.phase === "meta" ? loader.state.message : ""}…</p>
              <progress aria-label="Loading session data" />
            </>
          )}
        </section>
        </main>
      </div>
    );
  }
  return <Loaded loader={loader} meta={meta} initialTime={initialTime} onPlayhead={setPlayhead} />;
}

type LoaderResult = ReturnType<typeof useSession>;

function Loaded({ loader, meta, initialTime, onPlayhead }: { loader: LoaderResult; meta: NonNullable<LoaderResult["meta"]>; initialTime: number | null; onPlayhead: (t: number) => void }) {
  const view = useMemo(() => buildStatic(meta), [meta]);
  const targets = useMemo(() => jumpTargets(meta.kind, meta.laps, meta.raceControl, meta.session.session_name), [meta]);
  const firstWindow = meta.source === "fixtures" ? meta.windows[0]?.from : null;
  const clock = useClock(meta.span, initialTime ?? (firstWindow ? firstWindow + 15_000 : meta.span.start));
  const t = clock.t;
  // Tables, flags and inference are recomputed a few times a second; car dots every frame.
  const slowT = useThrottled(t, 200);
  const { telemetry, version } = loader;
  const snapshot = useMemo(() => buildSnapshot(meta, view, telemetry, slowT), [meta, view, telemetry, slowT, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cars: CarDot[] = useMemo(() => {
    if (!view.transform) return [];
    const out: CarDot[] = [];
    for (const [driver, trace] of telemetry.traces) {
      const p = traceAt(trace, t);
      if (p) out.push({ driver, ...toMap(view.transform, p) });
    }
    return out;
  }, [telemetry, view.transform, t, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the loader where the playhead is (to the minute) so it downloads that window first.
  const playheadMinute = Math.floor(slowT / 60_000);
  useEffect(() => onPlayhead(playheadMinute * 60_000), [playheadMinute, onPlayhead]);

  const [selected, setSelected] = useState<number | null>(null);
  // Clicking a driver selects it, clicking it again or anywhere that is not a driver clears it,
  // and so does Escape.
  const select = useCallback((driver: number) => setSelected((current) => (current === driver ? null : driver)), []);
  useEffect(() => {
    if (selected === null) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-driver]")) setSelected(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected]);
  const [phaseChoice, setPhaseChoice] = useState<Phase | null>(null);
  const [live, setLive] = useState(false);
  const qualifying = snapshot.qualifying;
  const phase = phaseChoice ?? qualifying?.current ?? qualifying?.phases.at(-1)?.phase ?? 1;
  const qPhase = qualifying?.phases.find((p) => p.phase === phase);
  const sel = selected !== null ? view.drivers[selected] : null;
  const racePos = snapshot.race?.find((r) => r.driver === selected);
  const finalQuali = meta.qualifying?.results ?? (meta.kind === "qualifying" ? meta.results : []);
  const qualiPos = finalQuali.find((r) => r.driver_number === selected)?.position ?? null;
  const prefix = meta.session.session_name.startsWith("Sprint") ? "SQ" : "Q";
  const currentTarget = [...targets].reverse().find((x) => x.t <= t + 500);
  const year = meta.session.year;
  const progress = loader.progress;
  const span = meta.span;

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <div className="hd" style={{ color: "var(--red-text)" }}>Race weekend dashboard</div>
          <h1>{meta.meeting.meeting_name}</h1>
          <p>{meta.session.circuit_short_name} · {meta.session.session_name} · {year} · {meta.source === "fixtures" ? "recorded fixtures" : "OpenF1 historical data"}</p>
        </div>
        <div className="pills" aria-live="polite">
          <span className="pill">{meta.source === "fixtures" ? "Fixture data" : "Replay"}</span>
          {meta.kind === "race" ? <span className="pill">{snapshot.beforeStart ? "Before the start · grid and formation lap" : `Lap ${snapshot.lap} / ${view.totalLaps ?? "?"}`}</span> : currentTarget && <span className="pill">{currentTarget.label}</span>}
          {snapshot.flags.map((f) => <span key={f.sector} className="pill flag">{f.flag} · Marshal sector {f.sector}</span>)}
          {snapshot.safetyCar && <span className="pill flag">{snapshot.safetyCar.kind === "VSC" ? "Virtual safety car" : "Safety car"}</span>}
          {snapshot.red && <span className="pill red">Red flag · session stopped</span>}
          {!snapshot.flags.length && !snapshot.safetyCar && !snapshot.red && <span className="pill clear">Track clear</span>}
        </div>
      </header>

      <main style={{ display: "contents" }}>
      <div className="toolbar" role="region" aria-label="Session and replay controls">
        <SessionPicker label={`${meta.meeting.meeting_name} · ${meta.session.session_name}`} current={{ year, meetingKey: meta.meeting.meeting_key, sessionKey: meta.session.session_key }} />
        <div role="group" aria-label="Data mode" className="segmented">
          <button className="seg" aria-pressed={live} onClick={() => setLive(true)}>Live</button>
          <button className="seg" aria-pressed={!live} onClick={() => setLive(false)}>Replay</button>
        </div>
        {live ? (
          <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <span className="live-dot" /><strong style={{ fontWeight: 600 }}>Live</strong>
            <span className="muted">needs OpenF1&apos;s paid tier, which is not set up. Showing the replay.</span>
          </span>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button className="tab" onClick={() => clock.setPlaying(!clock.playing)} aria-label={clock.playing ? "Pause" : "Play"}>{clock.playing ? "Pause" : "Play"}</button>
          <div role="group" aria-label="Playback speed" className="segmented">
            {SPEEDS.map((s) => (
              <button key={s} className="seg" style={{ padding: "0 12px" }} aria-pressed={clock.speed === s} onClick={() => clock.setSpeed(s as Speed)}>{s}×</button>
            ))}
          </div>
        </div>
        <div className="scrub">
          <label htmlFor="scrub">
            {meta.kind === "race" ? (!snapshot.beforeStart ? <>Replay lap <strong>{snapshot.lap}</strong></> : <>Replay <strong>before the start</strong></>) : <>Replay <strong>{currentTarget?.label ?? "before the start"}</strong></>}
            <span className="muted"> · {formatClock(t)} UTC</span>
          </label>
          <input
            id="scrub"
            type="range"
            min={0}
            max={Math.round((span.end - span.start) / 1000)}
            step={1}
            value={Math.round((t - span.start) / 1000)}
            onChange={(e) => clock.seek(span.start + Number(e.target.value) * 1000)}
            aria-valuetext={`${formatClock(t)} UTC${meta.kind === "race" ? `, lap ${snapshot.lap}` : ""}`}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="jump" className="muted" style={{ fontSize: 14 }}>Jump to</label>
          <select id="jump" className="picker" value="" onChange={(e) => e.target.value && clock.seek(Number(e.target.value))}>
            <option value="">{meta.kind === "qualifying" ? "Phase…" : "Lap…"}</option>
            {targets.map((x) => <option key={x.label} value={x.t}>{x.label}</option>)}
          </select>
        </div>
        <div className="muted" style={{ fontSize: 13, flexBasis: "100%" }} aria-live="polite">
          Car data {progress.ready} of {progress.total} parts loaded
          {meta.source === "fixtures" ? " (only short recorded windows exist in offline mode)" : ""}
          {progress.failed > 0 && (
            <> · <span style={{ color: "var(--red-text)" }}>download failed: {progress.error}</span> <button className="seg" onClick={loader.retryChunks}>Retry</button></>
          )}
          {meta.source === "fixtures" && meta.windows.length > 0 && (
            <> · Recorded windows: {meta.windows.map((w) => (
              <button key={w.index} className="seg" style={{ minHeight: 32, padding: "0 8px" }} onClick={() => clock.seek(w.from + 15_000)}>{formatClock(w.from)}</button>
            ))}</>
          )}
        </div>
      </div>

      <div className="row">
        <section className="panel col-map">
          <div className="split">
            <h2>Track map</h2>
            {sel && (
              <div className="muted" style={{ fontSize: 14 }}>
                <strong style={{ color: "var(--text)", fontWeight: 600 }}>#{sel.number} {sel.code} · {sel.name}</strong>
                {qualiPos ? ` · ${prefix === "SQ" ? "Sprint quali" : "Quali"} P${qualiPos}` : ""}
                {racePos && ` · Race P${racePos.position}`}
                {racePos?.position === 1 ? " · leading" : racePos?.gap?.kind === "time" ? ` · +${racePos.gap.seconds.toFixed(1)} s to leader` : ""}
              </div>
            )}
          </div>
          {view.map ? (
            <TrackMap view={view} map={view.map} circuit={meta.session.circuit_short_name} snapshot={snapshot} cars={cars} selected={selected} onSelect={select} />
          ) : (
            <p className="note">No circuit outline: {meta.outlineNote}</p>
          )}
          {!snapshot.positionsAvailable && (
            <p className="note" role="status">
              {snapshot.telemetryLoaded
                ? "OpenF1 has no car positions for this moment, so no cars are shown."
                : meta.source === "fixtures"
                  ? "No car positions were recorded for this moment."
                  : progress.failed > 0
                    ? "Car positions for this moment could not be downloaded."
                    : "Car positions for this moment are still downloading."}
            </p>
          )}
          {snapshot.flags.some((f) => !f.placement.known) && (
            <p className="note">{snapshot.flags.filter((f) => !f.placement.known).map((f) => (f.placement.known ? "" : f.placement.reason)).join(" ")} Nothing is highlighted for it.</p>
          )}
          {meta.outline && <p className="note">{meta.outlineNote} The line is the racing line of that lap, not the track edges.</p>}
          <MapLegend />
        </section>
        <aside className="col-side">
          <FlagPanels view={view} snapshot={snapshot} />
        </aside>
      </div>

      <div className="row top">
        {qualifying && (
          <section className="panel col-quali">
            <div>
              <h2>{qualifying.sessionName} · sector times</h2>
              <p className="lede">
                {qualifying.final ? "Final result of the session that set the grid. " : "Laps completed so far. "}
                Best valid lap per driver in the selected phase; laps deleted by race control are left out.
              </p>
            </div>
            <div role="group" aria-label="Qualifying phase" style={{ display: "flex", gap: 8 }}>
              {qualifying.phases.map((p) => (
                <button key={p.phase} className="tab" aria-pressed={p.phase === phase} onClick={() => setPhaseChoice(p.phase)}>{prefix}{p.phase}</button>
              ))}
            </div>
            {qPhase ? <QualifyingTable view={view} phase={qPhase} t={snapshot.t} selected={selected} onSelect={select} /> : <p className="note">No timed laps in this phase yet.</p>}
            <div className="cutline">
              {qPhase?.cutAfter && <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><i />Drivers below the dashed line are eliminated</span>}
              <MarkLegend />
            </div>
            {qualifying.ideal && (
              <div className="inset ideal">
                <div>
                  <div className="hd">Ideal lap · whole session</div>
                  <div className="total">{formatLapTime(qualifying.ideal.total)}</div>
                </div>
                <div className="parts">
                  {qualifying.ideal.sectors.map((s, i) => <span key={i}><b>{formatSector(s.time)}</b> S{i + 1} · {view.drivers[s.driver]?.code}</span>)}
                </div>
              </div>
            )}
          </section>
        )}
        {snapshot.race && (
          <section className="panel col-race">
            <div>
              <h2>{meta.session.session_name} · splits</h2>
              <p className="lede">
                {snapshot.beforeStart
                  ? "Before the start: the order shown is the starting grid. The formation lap is not timed; laps, sectors and gaps begin at lights out."
                  : "Last completed lap per driver with the latest gaps. Purple is the fastest sector of the race so far, green a personal best."}
              </p>
            </div>
            {!snapshot.hasGaps && !snapshot.beforeStart && <p className="note">No gap data for this moment.</p>}
            <RaceTable view={view} rows={snapshot.race} snapshot={snapshot} selected={selected} onSelect={select} />
            {snapshot.classification && snapshot.classification.length > 0 && (
              <div className="inset" role="note">
                <div className="hd">Official result differs from the order on track</div>
                <ul className="note" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {snapshot.classification.map((d) => (
                    <li key={d.driver}>
                      {view.drivers[d.driver]?.code ?? `#${d.driver}`}: {d.official ? `classified P${d.official}` : "not classified"}
                      {d.onTrack ? `, P${d.onTrack} on track` : ""}
                      {d.status ? ` (${d.status.toLowerCase()})` : ""}
                    </li>
                  ))}
                </ul>
                <p className="note" style={{ marginTop: 6 }}>The position feed shows the order on track; penalties applied after the flag appear only in the official result.</p>
              </div>
            )}
            {snapshot.trend && <GapChart view={view} trend={snapshot.trend} snapshot={snapshot} />}
          </section>
        )}
      </div>

      </main>
      <footer className="footer">
        Data: OpenF1 (unofficial, not affiliated with Formula 1; CC BY-NC-SA 4.0). Track outline drawn from OpenF1 car positions; marshal-sector limits from MultiViewer circuit data where available. Stopped-car detection is calculated here from car speed and position, not reported by the stewards. Lap data has no deleted-lap flag; laps are removed using race-control deletion messages.
      </footer>
    </div>
  );
}
