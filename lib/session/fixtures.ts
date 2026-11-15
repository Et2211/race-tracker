import "server-only";
import { readFixture } from "@/lib/fixtures/load";
import type { CarDataRow, Driver, IntervalRow, Lap, LocationRow, Meeting, PitRow, PositionRow, RaceControl, Session, SessionResult } from "@/lib/openf1/types";
import { assembleMeta, outlineFrom, type LearnedSectors } from "./assemble";
import { encodeChunk } from "./telemetry";
import type { MultiViewerCircuit } from "@/lib/track/markers";
import type { SessionMeta, TelemetryChunk } from "./types";

/**
 * Recorded sessions for offline use (F1_DATA_MODE=fixtures) and tests. Only the windows listed
 * here have car telemetry; the rest of each session shows as "not recorded".
 */
type FixtureSession = {
  slug: string;
  sessionKey: number;
  windows: { name: string; from: string; to: string }[];
  /** Location file and lap used for the outline. */
  outline?: { file: string; driver: number; lap: number };
  /** Take the outline from another fixture at the same circuit. */
  outlineFrom?: string;
  qualifying?: string;
};

export const FIXTURE_SESSIONS: FixtureSession[] = [
  {
    slug: "2026-madrid-race",
    sessionKey: 11369,
    windows: [
      { name: "lap5-yellow-s23", from: "2026-09-13T13:12:05Z", to: "2026-09-13T13:13:05Z" },
      { name: "lap14-vsc-double-yellow-s5", from: "2026-09-13T13:26:30Z", to: "2026-09-13T13:29:40Z" },
    ],
    outline: { file: "outline-lap-63-49", driver: 63, lap: 49 },
    qualifying: "2026-madrid-qualifying",
  },
  { slug: "2026-madrid-qualifying", sessionKey: 11365, windows: [], outlineFrom: "2026-madrid-race" },
  {
    slug: "2026-sao-paulo-race",
    sessionKey: 11412,
    windows: [
      { name: "lap17-double-yellow-s2", from: "2026-11-08T17:26:55Z", to: "2026-11-08T17:28:20Z" },
      { name: "lap61-double-yellow-s2", from: "2026-11-08T18:22:10Z", to: "2026-11-08T18:23:25Z" },
      { name: "lap63-double-yellow-s15", from: "2026-11-08T18:25:40Z", to: "2026-11-08T18:27:00Z" },
    ],
    outline: { file: "outline-lap-12-55", driver: 12, lap: 55 },
    qualifying: "2026-sao-paulo-qualifying",
  },
  { slug: "2026-sao-paulo-qualifying", sessionKey: 11408, windows: [], outlineFrom: "2026-sao-paulo-race" },
];

export const fixtureFor = (sessionKey: number) => FIXTURE_SESSIONS.find((f) => f.sessionKey === sessionKey) ?? null;
const bySlug = (slug: string) => FIXTURE_SESSIONS.find((f) => f.slug === slug)!;

const file = <T,>(slug: string, name: string) => readFixture<T>(`openf1/${slug}/${name}.json`);

async function fixtureOutline(f: FixtureSession) {
  const source = f.outline ? f : f.outlineFrom ? bySlug(f.outlineFrom) : null;
  if (!source?.outline) return null;
  const laps = await file<Lap[]>(source.slug, "laps");
  const lap = laps.find((l) => l.driver_number === source.outline!.driver && l.lap_number === source.outline!.lap);
  if (!lap) return null;
  return outlineFrom(lap, await file<LocationRow[]>(source.slug, `location.${source.outline.file}`));
}

export async function fixtureMeta(
  sessionKey: number,
  extras: { multiviewer: MultiViewerCircuit | null; learned: LearnedSectors | null },
): Promise<SessionMeta | null> {
  const f = fixtureFor(sessionKey);
  if (!f) return null;
  const [session, meeting, drivers, laps, raceControl, positions, pits, results, outline] = await Promise.all([
    file<Session>(f.slug, "session"),
    file<Meeting>(f.slug, "meeting"),
    file<Driver[]>(f.slug, "drivers"),
    file<Lap[]>(f.slug, "laps"),
    file<RaceControl[]>(f.slug, "race_control"),
    file<PositionRow[]>(f.slug, "position"),
    file<PitRow[]>(f.slug, "pit"),
    file<SessionResult[]>(f.slug, "session_result"),
    fixtureOutline(f),
  ]);
  const intervals = (await Promise.all(f.windows.map((w) => file<IntervalRow[]>(f.slug, `intervals.${w.name}`)))).flat();
  let qualifying: SessionMeta["qualifying"] = null;
  if (f.qualifying) {
    const q = bySlug(f.qualifying);
    const [qs, ql, qrc, qr] = await Promise.all([
      file<Session>(q.slug, "session"),
      file<Lap[]>(q.slug, "laps"),
      file<RaceControl[]>(q.slug, "race_control"),
      file<SessionResult[]>(q.slug, "session_result"),
    ]);
    qualifying = { sessionKey: qs.session_key, sessionName: qs.session_name, laps: ql, raceControl: qrc, results: qr };
  }
  const meta = assembleMeta({
    session,
    meeting,
    drivers,
    laps,
    raceControl,
    positions,
    intervals,
    pits,
    results,
    outline,
    outlineNote: outline ? "Drawn from one recorded lap." : "No recorded lap to draw the circuit from.",
    multiviewer: extras.multiviewer,
    learned: extras.learned,
    qualifying,
    source: "fixtures",
  });
  // Only the recorded windows have telemetry.
  meta.windows = f.windows.map((w, index) => ({ index, from: Date.parse(w.from), to: Date.parse(w.to) }));
  return meta;
}

export async function fixtureChunk(sessionKey: number, index: number): Promise<TelemetryChunk | null> {
  const f = fixtureFor(sessionKey);
  const w = f?.windows[index];
  if (!f || !w) return null;
  const [location, carData] = await Promise.all([file<LocationRow[]>(f.slug, `location.${w.name}`), file<CarDataRow[]>(f.slug, `car_data.${w.name}`)]);
  return encodeChunk(index, Date.parse(w.from), Date.parse(w.to), location, carData);
}

export async function fixtureSessions(): Promise<Session[]> {
  return Promise.all(FIXTURE_SESSIONS.map((f) => file<Session>(f.slug, "session")));
}

export async function fixtureMeetings(): Promise<Meeting[]> {
  const all = await Promise.all(FIXTURE_SESSIONS.map((f) => file<Meeting>(f.slug, "meeting")));
  return all.filter((m, i) => all.findIndex((x) => x.meeting_key === m.meeting_key) === i);
}
