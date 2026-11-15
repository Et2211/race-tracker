import type { Driver, IntervalRow, Lap, Meeting, PitRow, PositionRow, RaceControl, Session, SessionResult, Stint } from "@/lib/openf1/types";
import type { Outline } from "@/lib/track/geometry";
import type { MarshalSectors } from "@/lib/track/markers";

/** Bump when SessionMeta or TelemetryChunk changes shape; it is part of the URLs the browser caches. */
export const DATA_FORMAT = 3;

export type SessionKind = "race" | "qualifying" | "practice" | "other";

export function sessionKind(session: Pick<Session, "session_type" | "session_name">): SessionKind {
  if (session.session_type === "Race") return "race"; // includes "Sprint"
  if (session.session_type === "Qualifying") return "qualifying"; // includes "Sprint Qualifying"
  if (session.session_type === "Practice") return "practice"; // followed live only, never stored
  return "other";
}

/** Timing of a qualifying session, used beside a race for the qualifying panel. */
export type QualifyingTiming = {
  sessionKey: number;
  sessionName: string;
  laps: Lap[];
  raceControl: RaceControl[];
  results: SessionResult[];
};

/** Everything about a session except high-rate telemetry. Small enough to load at once. */
export type SessionMeta = {
  version: 1;
  session: Session;
  meeting: Meeting;
  kind: SessionKind;
  drivers: Driver[];
  laps: Lap[];
  /** Sorted by date, like every array of dated rows below. */
  raceControl: RaceControl[];
  positions: PositionRow[];
  intervals: IntervalRow[];
  pits: PitRow[];
  /** Tyre stints, races and sprints only. Absent on sessions stored before tyres were kept. */
  stints?: Stint[];
  results: SessionResult[];
  outline: Outline | null;
  /** Why there is no outline, or where it came from. */
  outlineNote: string;
  rotation: number | null;
  marshal: MarshalSectors;
  /** From the first lap start (or session start) to the end of running, epoch ms. */
  span: { start: number; end: number };
  /** Telemetry windows covering the span, in order. */
  windows: { index: number; from: number; to: number }[];
  /** For races: the meeting's qualifying (or sprint qualifying) session. */
  qualifying: QualifyingTiming | null;
  /** "live": assembled from OpenF1's real-time feed while the session runs; it grows. */
  source: "openf1" | "fixtures" | "live";
};

/**
 * One window of high-rate data. Times are milliseconds since `from`; `t`, `x` and `y` are
 * delta-encoded (each value is the difference from the previous one) to keep the JSON small.
 */
export type TelemetryChunk = {
  index: number;
  from: number;
  to: number;
  cars: {
    driver: number;
    loc: { t: number[]; x: number[]; y: number[] };
    car: { t: number[]; speed: number[]; throttle: number[]; brake: number[]; gear: number[]; rpm: number[] };
  }[];
};
