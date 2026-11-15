import type { Confidence } from "@/lib/incident/stopped";
import type { LogTone } from "@/lib/flags/state";
import type { IdealLap, Phase, QualifyingPhase } from "@/lib/timing/qualifying";
import type { RaceRow, TrendSeries } from "@/lib/timing/race";

// What the dashboard renders, derived from session data at a replay time.

export type DriverInfo = { number: number; code: string; name: string; team: string; colour: string };

export type TrackMapModel = {
  width: number;
  height: number;
  /** One path per timing sector, in order. */
  sectorPaths: [string, string, string];
  /** Ticks across the track at the start line and the two sector boundaries. */
  ticks: { x1: number; y1: number; x2: number; y2: number; start: boolean }[];
  labels: { x: number; y: number; text: string; sector: 0 | 1 | 2 | 3 }[];
};

export type CarDot = { driver: number; x: number; y: number };

export type SectorPlacementView =
  | { known: true; path: string; flagX: number; flagY: number; basis: string }
  | { known: false; reason: string };

export type StoppedCarView = {
  driver: number;
  /** "STOPPED FIRST", "STOPPED", "STOPPED ELSEWHERE", "POSSIBLE CONTACT" or "NAMED BY RACE CONTROL". */
  role: "first" | "stopped" | "elsewhere" | "contact" | "named";
  evidence: string[];
  /** Where the car stopped, in map space; null when it did not stop. */
  x: number | null;
  y: number | null;
};

export type FlagView = {
  flag: "YELLOW" | "DOUBLE YELLOW";
  sector: number;
  /** Neighbouring sectors flagged for the same incident. */
  alsoSectors: number[];
  raisedAt: string;
  lap: number | null;
  /** Minutes since the flag without a CLEAR message, once that is unusually long. */
  staleMinutes: number | null;
  placement: SectorPlacementView;
  stopped: StoppedCarView[];
  confidence: Confidence;
  confidenceNote: string;
  /** False when car telemetry around the flag is not loaded, so no inference was made. */
  inferred: boolean;
};

/** `pre` marks messages before lights out; OpenF1 stamps those with lap 1. */
export type LogEntry = { lap: number | null; pre: boolean; time: string; text: string; tone: LogTone };

export type QualifyingView = {
  sessionName: string;
  phases: QualifyingPhase[];
  ideal: IdealLap | null;
  /** The phase running at the replay time, for qualifying sessions. */
  current: Phase | null;
  /** True when the table shows the session's final result (a race weekend's qualifying). */
  final: boolean;
};

export type Snapshot = {
  t: number;
  time: string;
  lap: number;
  /** A race before lights out: the grid and the formation lap. Laps, times and gaps start at lights out. */
  beforeStart: boolean;
  totalLaps: number | null;
  flags: FlagView[];
  safetyCar: { kind: "SC" | "VSC"; ending: boolean } | null;
  red: boolean;
  cars: CarDot[];
  /** Telemetry for this moment has been downloaded. */
  telemetryLoaded: boolean;
  /** Downloaded, and OpenF1 actually has car positions for this moment. */
  positionsAvailable: boolean;
  race: RaceRow[] | null;
  hasGaps: boolean;
  /** After the finish: where the official result differs from the order on track. */
  classification: { driver: number; onTrack: number | null; official: number | null; status: string | null }[] | null;
  leader: number | null;
  trend: { fromLap: number; toLap: number; series: TrendSeries[] } | null;
  qualifying: QualifyingView | null;
  log: LogEntry[];
};
