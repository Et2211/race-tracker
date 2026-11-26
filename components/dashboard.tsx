"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildSnapshot, buildStatic } from "@/lib/dashboard/snapshot";
import type { CarDot } from "@/lib/dashboard/model";
import { SPEEDS, useClock, useThrottled, type Speed } from "@/lib/replay/use-clock";
import type { LiveStatusView } from "@/lib/live/http";
import { useLiveClock } from "@/lib/replay/use-live-clock";
import { useLiveSession } from "@/lib/replay/use-live";
import { useSession } from "@/lib/replay/use-session";
import { REACTION_MS, syncPoints, type SyncPoint } from "@/lib/replay/sync";
import { jumpTargets } from "@/lib/replay/timeline";
import { practiceClock, qualifyingClock, quietStretches } from "@/lib/timing/session-clock";
import { traceAt } from "@/lib/session/telemetry";
import type { SessionMeta } from "@/lib/session/types";
import { formatClock, formatLapTime, formatSector } from "@/lib/timing/format";
import type { Phase } from "@/lib/timing/qualifying";
import { toMap } from "@/lib/track/map";
import { DriverPanel } from "./driver/driver-panel";
import { FlagPanels } from "./flag-panels";
import { GapChart } from "./gap-chart";
import { PracticeClockPill, QualifyingClockPill, WatchLiveButton } from "./session-clock";
import { replayAfter } from "@/lib/session/catalog";
import { scrubTrack } from "@/lib/replay/scrub-track";
import { FinishedLine, NotLivePanel } from "./live-ended";
import { LiveStatusLine } from "./live-status";
import { SyncControl } from "./sync-control";
import { WatchPanel } from "./watch-panel";
import { SessionPicker } from "./session-picker";
import { MarkLegend, QualifyingTable, RaceTable } from "./timing-tables";
import { MapLegend, TrackMap } from "./track-map";

const NO_QUIET: [number, number][] = [];
const NO_LAPS: SessionMeta["laps"] = [];
/** Jumping to a phase lands this long before its start, to see the pit exit open. */
const PHASE_LEAD_MS = 10_000;

type LoaderResult = ReturnType<typeof useSession> & { live?: { status: LiveStatusView | null } };

export function SessionDashboard({ sessionKey, initialTime }: { sessionKey: number; initialTime: number | null }) {
  const [playhead, setPlayhead] = useState<number | null>(initialTime);
  const loader = useSession(sessionKey, playhead);
  return <Shell loader={loader} sessionKey={sessionKey} initialTime={initialTime} onPlayhead={setPlayhead} mode="replay" />;
}

/** A session while it runs, from OpenF1's real-time feed (relayed and stored by the server). */
export function LiveDashboard({ sessionKey }: { sessionKey: number }) {
  const [playhead, setPlayhead] = useState<number | null>(null);
  const loader = useLiveSession(sessionKey, playhead);
  return <Shell loader={loader} sessionKey={sessionKey} initialTime={null} onPlayhead={setPlayhead} mode="live" />;
}

function Shell({ loader, sessionKey, initialTime, onPlayhead, mode }: { loader: LoaderResult; sessionKey: number; initialTime: number | null; onPlayhead: (t: number) => void; mode: "replay" | "live" }) {
  const { meta } = loader;
  if (!meta) {
    return (
      <div className="page">
        <main className="page-main">
        <Link href="/" className="back">← All sessions</Link>
        <section className="panel" aria-live="polite">
          {loader.state.phase === "error" && loader.state.notLive ? (
            <NotLivePanel why={loader.state.notLive} sessionKey={sessionKey} onRetry={loader.retry} />
          ) : loader.state.phase === "error" ? (
            <>
              <h2>{mode === "live" ? "Could not connect to the live session" : "Could not load this session"}</h2>
              <p className="note" role="alert">{loader.state.message}</p>
              <button className="tab" style={{ alignSelf: "flex-start" }} onClick={loader.retry}>Try again</button>
            </>
          ) : (
            <>
              <h2>{mode === "live" ? "Connecting to the live session" : "Loading the session"}</h2>
              <p className="note">{loader.state.phase === "meta" ? loader.state.message : ""}…</p>
              <progress aria-label="Loading session data" />
            </>
          )}
        </section>
        </main>
      </div>
    );
  }
  return <Loaded loader={loader} meta={meta} initialTime={initialTime} onPlayhead={onPlayhead} mode={mode} />;
}

function Loaded({ loader, meta, initialTime, onPlayhead, mode }: { loader: LoaderResult; meta: NonNullable<LoaderResult["meta"]>; initialTime: number | null; onPlayhead: (t: number) => void; mode: "replay" | "live" }) {
  // Live, the session object changes every second; these only change when their inputs do.
  const staticLaps = mode === "live" ? NO_LAPS : meta.laps; // live shows no lap total
  const view = useMemo(
    () => buildStatic({ drivers: meta.drivers, kind: meta.kind, laps: staticLaps, outline: meta.outline, rotation: meta.rotation }),
    [meta.drivers, meta.kind, staticLaps, meta.outline, meta.rotation],
  );
  const targets = useMemo(() => jumpTargets(meta.kind, meta.laps, meta.raceControl, meta.session.session_name), [meta.kind, meta.laps, meta.raceControl, meta.session.session_name]);
  const firstWindow = meta.source === "fixtures" ? meta.windows[0]?.from : null;
  const isLive = mode === "live";
  const liveStatus = loader.live?.status ?? null;
  const latest = liveStatus?.lastSecond !== null && liveStatus?.lastSecond !== undefined ? (liveStatus.lastSecond + 1) * 1000 : null;
  // Over: past its scheduled end, and the relays have stopped (30 minutes after it, by then).
  const sessionEnd = Date.parse(meta.session.date_end);
  const finished = isLive && liveStatus !== null && liveStatus.relaysAlive === 0 && liveStatus.now > sessionEnd;
  const quiet = useMemo(() => (meta.kind === "qualifying" ? quietStretches(meta.raceControl, meta.laps) : []), [meta.kind, meta.raceControl, meta.laps]);
  const [skipBreaks, setSkipBreaks] = useState(true);
  const replayClock = useClock(meta.span, initialTime ?? (firstWindow ? firstWindow + 15_000 : meta.span.start), skipBreaks ? quiet : NO_QUIET);
  const liveClock = useLiveClock(latest, isLive);
  const clock = isLive ? liveClock : replayClock;
  const sync = useMemo(() => syncPoints(meta.kind, meta.laps, meta.raceControl, meta.session.session_name), [meta.kind, meta.laps, meta.raceControl, meta.session.session_name]);
  // The point the replay was synced to; any move other than a nudge or play/pause ends the sync.
  const [synced, setSynced] = useState<SyncPoint | null>(null);
  const seek = (to: number) => {
    setSynced(null);
    clock.seek(to);
  };
  const t = clock.t;
  // Tables, flags and inference are recomputed a few times a second; car dots every frame.
  const slowT = useThrottled(t, 200);
  const { telemetry, version } = loader;
  const snapshot = useMemo(() => buildSnapshot(meta, view, telemetry, slowT), [meta, view, telemetry, slowT, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cars: CarDot[] = useMemo(() => {
    if (!view.transform) return [];
    const out: CarDot[] = [];
    const retired = new Set(snapshot.retired);
    for (const [driver, trace] of telemetry.traces) {
      if (retired.has(driver)) continue;
      const p = traceAt(trace, t);
      if (p) out.push({ driver, ...toMap(view.transform, p) });
    }
    return out;
  }, [telemetry, view.transform, t, version, snapshot.retired]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the loader where the playhead is (to the minute) so it downloads that window first.
  const playheadMinute = Math.floor(slowT / 60_000);
  useEffect(() => onPlayhead(playheadMinute * 60_000), [playheadMinute, onPlayhead]);

  const [selected, setSelected] = useState<number | null>(null);
  // Clicking a driver selects it, clicking it again or anywhere that is not a driver clears it,
  // and so does Escape. Clicks in the replay controls and the driver focus panel keep it, so the
  // focused driver can be followed while playing.
  const select = useCallback((driver: number) => setSelected((current) => (current === driver ? null : driver)), []);
  useEffect(() => {
    if (selected === null) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-driver], [data-keeps-selection]")) setSelected(null);
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
  const qualifying = snapshot.qualifying;
  const phase = phaseChoice ?? qualifying?.current ?? qualifying?.phases.at(-1)?.phase ?? 1;
  const qPhase = qualifying?.phases.find((p) => p.phase === phase);
  const sel = selected !== null ? view.drivers[selected] : null;
  const racePos = snapshot.race?.find((r) => r.driver === selected);
  const finalQuali = meta.qualifying?.results ?? (meta.kind === "qualifying" ? meta.results : []);
  const qualiPos = finalQuali.find((r) => r.driver_number === selected)?.position ?? null;
  const prefix = meta.session.session_name.startsWith("Sprint") ? "SQ" : "Q";
  // The phase or lap being shown; a phase counts from the moment a jump lands, just before it starts.
  const currentTarget = [...targets].reverse().find((x) => x.t <= t + (meta.kind === "qualifying" ? PHASE_LEAD_MS : 0) + 500);
  const year = meta.session.year;
  const progress = loader.progress;
  const span = meta.span;
  const scrubEnd = isLive ? Math.max(latest ?? clock.t, clock.t) : span.end;
  // The index fills in place; `version` changes as it does.
  const loadedRanges = useMemo(() => telemetry.ranges(), [telemetry, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickerCurrent = useMemo(() => ({ year, meetingKey: meta.meeting.meeting_key, sessionKey: meta.session.session_key }), [year, meta.meeting.meeting_key, meta.session.session_key]);
  const qClock = meta.kind === "qualifying" ? qualifyingClock(meta.raceControl, slowT, prefix === "SQ", year) : null;
  const pClock = meta.kind === "practice" ? practiceClock(meta.session, meta.raceControl, slowT) : null;
  // Screen readers hear the position when it changes meaningfully, not every second of playback.
  const scrubText = `${meta.kind === "race" ? (snapshot.beforeStart ? "before the start" : `lap ${snapshot.lap}`) : meta.kind === "practice" ? meta.session.session_name : (currentTarget?.label ?? "before the start")}, ${formatClock(Math.floor(slowT / 10_000) * 10_000)} UTC`;

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <Link href="/" className="back">← All sessions</Link>
          <div className="hd" style={{ color: "var(--red-text)" }}><Link href="/" className="home-link">Speed Trace</Link></div>
          <h1>{meta.meeting.meeting_name}</h1>
          <p>{meta.session.circuit_short_name} · {meta.session.session_name} · {year}</p>
        </div>
        <div className="pills" aria-live="polite">
          {finished ? <span className="pill">Finished</span> : isLive ? <span className="pill live-pill"><span className="live-dot" />Live</span> : <WatchLiveButton session={meta.session} />}
          {meta.kind === "race" ? <span className="pill">{snapshot.beforeStart ? "Before the start · grid and formation lap" : isLive ? `Lap ${snapshot.lap}` : `Lap ${snapshot.lap} / ${view.totalLaps ?? "?"}`}</span> : currentTarget && <span className="pill">{currentTarget.label}</span>}
          {snapshot.flags.map((f) => <span key={f.sector} className="pill flag">{f.flag} · Marshal sector {f.sector}</span>)}
          {snapshot.safetyCar && <span className="pill flag">{snapshot.safetyCar.kind === "VSC" ? "Virtual safety car" : "Safety car"}</span>}
          {snapshot.red && <span className="pill red">Red flag · session stopped</span>}
          {!snapshot.flags.length && !snapshot.safetyCar && !snapshot.red && <span className="pill clear">Track clear</span>}
        </div>
      </header>

      <main className="page-main">
      <div className="toolbar" role="region" aria-label="Session and replay controls" data-keeps-selection>
        <div className="toolbar-row">
          {!isLive && <SessionPicker label={`${meta.meeting.meeting_name} · ${meta.session.session_name}`} current={pickerCurrent} />}
          {finished ? (
            <FinishedLine sessionKey={meta.session.session_key} replayAt={sessionEnd + replayAfter(meta.kind === "practice")} />
          ) : (
            isLive && <LiveStatusLine status={liveStatus} behind={liveClock.behind} synced={liveClock.synced} following={liveClock.following} onCatchUp={liveClock.toTarget} />
          )}
          {qClock && <QualifyingClockPill clock={qClock} prefix={prefix} live={isLive} t={slowT} />}
          {pClock && <PracticeClockPill clock={pClock} name={meta.session.session_name} live={isLive} t={slowT} />}
          <span className="toolbar-spacer" />
          <SyncControl
            live={isLive}
            points={sync}
            synced={synced}
            playing={clock.playing}
            onSync={(p) => {
              if (isLive) liveClock.syncTo(p.t + REACTION_MS);
              else {
                replayClock.seek(p.t + REACTION_MS);
                replayClock.setSpeed(1);
                replayClock.setPlaying(true);
              }
              setSynced(p);
            }}
            onNudge={(ms) => (isLive ? liveClock.nudge(ms) : replayClock.seek(replayClock.t + ms))}
          />
        </div>
        <div className="toolbar-row">
          <button className="tab" onClick={() => clock.setPlaying(!clock.playing)} aria-label={clock.playing ? "Pause" : "Play"}>{clock.playing ? "Pause" : "Play"}</button>
          {!isLive && (
            <div role="group" aria-label="Playback speed" className="segmented">
              {SPEEDS.map((s) => (
                <button key={s} className="seg" aria-pressed={clock.speed === s} onClick={() => {
                  if (s !== clock.speed) setSynced(null);
                  clock.setSpeed(s as Speed);
                }}>{s}×</button>
              ))}
            </div>
          )}
          {meta.kind === "qualifying" && targets.length > 0 ? (
            <div role="group" aria-label="Jump to a phase" className="segmented">
              {targets.map((x) => (
                <button key={x.label} className="seg" aria-pressed={currentTarget?.label === x.label} onClick={() => seek(x.t - PHASE_LEAD_MS)}>{x.label}</button>
              ))}
            </div>
          ) : targets.length === 0 ? null : (
            <label className="control">
              <span className="muted">Jump to</span>
              <select className="picker" value="" onChange={(e) => e.target.value && seek(Number(e.target.value))}>
                <option value="">Lap…</option>
                {targets.map((x) => <option key={x.label} value={x.t}>{x.label}</option>)}
              </select>
            </label>
          )}
          {!isLive && quiet.length > 0 && (
            <label className="control check">
              <input type="checkbox" checked={skipBreaks} onChange={(e) => setSkipBreaks(e.target.checked)} />
              Skip breaks
            </label>
          )}
          <span className="toolbar-spacer" />
          <span className="clock-label" aria-hidden="true">
            {isLive ? "Live " : "Replay "}
            {meta.kind === "race" ? (!snapshot.beforeStart ? <>lap <strong>{snapshot.lap}</strong></> : <strong>before the start</strong>) : meta.kind === "practice" ? <strong>{meta.session.session_name}</strong> : <strong>{currentTarget?.label ?? "before the start"}</strong>}
            <span className="muted"> · {formatClock(t)} UTC</span>
          </span>
        </div>
        <input
          className="scrubber"
          style={{ "--scrub-bg": scrubTrack(loadedRanges, span.start, scrubEnd, t) } as React.CSSProperties}
          type="range"
          aria-label="Session time"
          min={0}
          max={Math.max(0, Math.round((scrubEnd - span.start) / 1000))}
          step={1}
          value={Math.round((t - span.start) / 1000)}
          onChange={(e) => seek(span.start + Number(e.target.value) * 1000)}
          aria-valuetext={scrubText}
        />
        <div className="toolbar-note muted">
          {!isLive && <>Car data {progress.ready} of {progress.total} parts loaded</>}
          {meta.source === "fixtures" ? " (only short recorded windows exist in offline mode)" : ""}
          {progress.failed > 0 && (
            <> · <span role="alert" style={{ color: "var(--red-text)" }}>download failed: {progress.error}</span> <button className="seg small" onClick={loader.retryChunks}>Retry</button></>
          )}
          {meta.source === "fixtures" && meta.windows.length > 0 && (
            <> · Recorded windows: {meta.windows.map((w) => (
              <button key={w.index} className="seg small" onClick={() => seek(w.from + 15_000)}>{formatClock(w.from)}</button>
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
                {" · "}<a href="#driver-focus" className="inline-link" data-keeps-selection>Driver focus ↓</a>
              </div>
            )}
          </div>
          {view.map ? (
            <TrackMap view={view} map={view.map} circuit={meta.session.circuit_short_name} snapshot={snapshot} cars={cars} selected={selected} onSelect={select} />
          ) : (
            <p className="note">No track map for this session.</p>
          )}
          {!snapshot.positionsAvailable && (
            <p className="note" role="status">
              {snapshot.telemetryLoaded
                ? "No car positions for this moment."
                : meta.source === "fixtures"
                  ? "No car positions were recorded for this moment."
                  : progress.failed > 0
                    ? "Car positions for this moment could not be downloaded."
                    : "Car positions for this moment are still downloading."}
            </p>
          )}
          <MapLegend />
        </section>
        <aside className="col-side">
          <FlagPanels view={view} snapshot={snapshot} />
          {snapshot.watch && <WatchPanel view={view} year={meta.session.year} watch={snapshot.watch} selected={selected} onSelect={select} />}
        </aside>
      </div>

      <div className="row top">
        {qualifying && (
          <section className="panel col-quali">
            <div>
              <h2>{qualifying.sessionName} · sector times</h2>
              <p className="lede">
                {meta.kind === "practice"
                  ? "Best lap per driver. Deleted laps don't count."
                  : "Best lap per driver in each phase. Deleted laps don't count."}
              </p>
            </div>
            {meta.kind !== "practice" && (
              <div role="group" aria-label="Qualifying phase" style={{ display: "flex", gap: 8 }}>
                {qualifying.phases.map((p) => (
                  <button key={p.phase} className="tab" aria-pressed={p.phase === phase} onClick={() => setPhaseChoice(p.phase)}>{prefix}{p.phase}</button>
                ))}
              </div>
            )}
            {qPhase ? <QualifyingTable view={view} phase={qPhase} t={snapshot.t} selected={selected} onSelect={select} title={meta.kind === "practice" ? `${meta.session.session_name} best laps` : undefined} /> : <p className="note">No timed laps yet.</p>}
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
                  ? "Starting grid. Timing begins at lights out."
                  : "Purple: fastest sector of the race so far. Green: personal best."}
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
                <p className="note" style={{ marginTop: 6 }}>Includes penalties applied after the flag.</p>
              </div>
            )}
            {snapshot.trend && <GapChart view={view} trend={snapshot.trend} snapshot={snapshot} />}
          </section>
        )}
      </div>

      <div className="row top" data-keeps-selection>
        <DriverPanel meta={meta} view={view} selected={selected} t={slowT} live={isLive} telemetry={telemetry} version={version} />
      </div>

      </main>
      <footer className="footer">
        Data: OpenF1 (unofficial, not affiliated with Formula 1; CC BY-NC-SA 4.0). Track outline drawn from OpenF1 car positions; marshal-sector limits from MultiViewer circuit data where available. Stopped-car detection is calculated here from car speed and position, not reported by the stewards. Lap data has no deleted-lap flag; laps are removed using race-control deletion messages.
      </footer>
    </div>
  );
}
