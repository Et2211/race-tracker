import type { Driver, IntervalRow, Lap, LocationRow, Meeting, PitRow, PositionRow, RaceControl, Session, SessionResult } from "@/lib/openf1/types";
import { buildOutline, type Outline, type TimedPoint } from "@/lib/track/geometry";
import { sectorsFromMultiViewer, type MarshalSectors, type MultiViewerCircuit } from "@/lib/track/markers";
import { sessionKind, type QualifyingTiming, type SessionMeta } from "./types";

export const WINDOW_MS = 15 * 60_000;

const byDate = <T extends { date: string }>(rows: T[]) => [...rows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

/** Learned marshal-sector observations kept in data/marshal-sectors/<circuit_key>.json. */
export type LearnedSectors = { count: number | null; observations: Record<string, { arc: number; session_key: number }[]> };

/**
 * The time span to replay. The session's date_end is the scheduled end, which a red flag can
 * overrun by half an hour, so the span comes from the running itself.
 */
export function runningSpan(kind: SessionMeta["kind"], laps: Lap[], raceControl: RaceControl[], session: Session): { start: number; end: number } {
  const starts = raceControl.filter((r) => r.message === "SESSION STARTED").map((r) => Date.parse(r.date));
  const lapStarts = laps.filter((l) => l.date_start).map((l) => Date.parse(l.date_start!));
  const lapEnds = laps.filter((l) => l.date_start && l.lap_duration !== null).map((l) => Date.parse(l.date_start!) + l.lap_duration! * 1000);
  const finishes = raceControl.filter((r) => r.message === "SESSION FINISHED" || r.flag === "CHEQUERED").map((r) => Date.parse(r.date));
  const first = starts.length || lapStarts.length ? Math.min(...starts, ...lapStarts) : Date.parse(session.date_start);
  // Races include the formation lap; other sessions start a minute before the first green.
  const start = first - (kind === "race" ? 5 : 1) * 60_000;
  const last = Math.max(...finishes, ...lapEnds, -Infinity);
  const end = (Number.isFinite(last) ? last : Date.parse(session.date_end)) + 3 * 60_000;
  return { start, end };
}

export function windowsFor(span: { start: number; end: number }) {
  const out: SessionMeta["windows"] = [];
  for (let from = span.start, i = 0; from < span.end; from += WINDOW_MS, i++) out.push({ index: i, from, to: Math.min(span.end, from + WINDOW_MS) });
  return out;
}

/** The fastest lap with all three sector times, which the outline is drawn from. */
export function outlineLap(laps: Lap[]): Lap | null {
  return (
    laps
      .filter((l) => l.date_start && l.lap_duration !== null && l.duration_sector_1 !== null && l.duration_sector_2 !== null && l.duration_sector_3 !== null && !l.is_pit_out_lap)
      .sort((a, b) => a.lap_duration! - b.lap_duration!)[0] ?? null
  );
}

/** Build the outline from location rows for `lap`. Null if the rows do not cover the lap. */
export function outlineFrom(lap: Lap, rows: LocationRow[]): Outline | null {
  const trace: TimedPoint[] = rows
    .filter((r) => r.driver_number === lap.driver_number && !(r.x === 0 && r.y === 0))
    .map((r) => ({ t: Date.parse(r.date), x: r.x, y: r.y }))
    .sort((a, b) => a.t - b.t);
  try {
    return buildOutline(trace, Date.parse(lap.date_start!), lap.duration_sector_1!, lap.duration_sector_2!, lap.lap_duration!);
  } catch {
    return null;
  }
}

/**
 * `forSession` is the session being shown: its own stops are left out of the learned positions,
 * so a replay never draws a sector from the incident it is showing (or from later in the same session).
 */
export function marshalSectors(outline: Outline | null, multiviewer: MultiViewerCircuit | null, learned: LearnedSectors | null, forSession: number): MarshalSectors {
  if (outline && multiviewer) {
    const fromFile = sectorsFromMultiViewer(outline, multiviewer);
    if (fromFile) return fromFile;
  }
  if (learned) {
    return {
      source: "learned",
      count: learned.count,
      observations: Object.fromEntries(Object.entries(learned.observations).map(([k, v]) => [Number(k), v.filter((o) => o.session_key !== forSession).map((o) => o.arc)])),
    };
  }
  return { source: "none" };
}

export type RawSession = {
  session: Session;
  meeting: Meeting;
  drivers: Driver[];
  laps: Lap[];
  raceControl: RaceControl[];
  positions: PositionRow[];
  intervals: IntervalRow[];
  pits: PitRow[];
  results: SessionResult[];
  outline: Outline | null;
  outlineNote: string;
  multiviewer: MultiViewerCircuit | null;
  learned: LearnedSectors | null;
  qualifying: QualifyingTiming | null;
  source: SessionMeta["source"];
};

/**
 * Race-control rows that belong to the session. The feed occasionally carries rows from another
 * day: the 2026 Mexico City race has a "SESSION STARTED" dated the previous afternoon, which
 * would otherwise stretch the replay to 29 hours.
 */
export function ownRaceControl(rows: RaceControl[], session: Session): RaceControl[] {
  const from = Date.parse(session.date_start) - 2 * 60 * 60_000;
  return byDate(rows.filter((r) => Date.parse(r.date) >= from));
}

export function assembleMeta(raw: RawSession): SessionMeta {
  const kind = sessionKind(raw.session);
  const raceControl = ownRaceControl(raw.raceControl, raw.session);
  const span = runningSpan(kind, raw.laps, raceControl, raw.session);
  return {
    version: 1,
    session: raw.session,
    meeting: raw.meeting,
    kind,
    drivers: raw.drivers,
    laps: raw.laps,
    raceControl,
    positions: byDate(raw.positions),
    intervals: byDate(raw.intervals),
    pits: raw.pits,
    results: raw.results,
    outline: raw.outline,
    outlineNote: raw.outlineNote,
    rotation: raw.multiviewer?.rotation ?? null,
    marshal: marshalSectors(raw.outline, raw.multiviewer, raw.learned, raw.session.session_key),
    span,
    windows: windowsFor(span),
    qualifying: raw.qualifying ? { ...raw.qualifying, raceControl: byDate(raw.qualifying.raceControl) } : null,
    source: raw.source,
  };
}

/** The qualifying session that set the grid for a race or sprint. */
export function qualifyingFor(session: Session, meetingSessions: Session[]): Session | null {
  const name = session.session_name === "Sprint" ? "Sprint Qualifying" : session.session_name === "Race" ? "Qualifying" : null;
  return (name && meetingSessions.find((s) => s.session_name === name)) || null;
}
