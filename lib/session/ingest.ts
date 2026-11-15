import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { openf1, TooMuchDataError } from "@/lib/openf1/client";
import type { CarDataRow, Driver, IntervalRow, Lap, LocationRow, Meeting, PitRow, PositionRow, RaceControl, Session, SessionResult } from "@/lib/openf1/types";
import { readJson, writeJson } from "@/lib/storage/store";
import type { MultiViewerCircuit } from "@/lib/track/markers";
import { assembleMeta, outlineFrom, outlineLap, qualifyingFor, WINDOW_MS, type LearnedSectors } from "./assemble";
import { encodeChunk } from "./telemetry";
import type { SessionMeta, TelemetryChunk } from "./types";

export const metaKey = (sessionKey: number) => `sessions/${sessionKey}/meta.json`;
export const chunkKey = (sessionKey: number, index: number) => `sessions/${sessionKey}/chunk-${index}.json`;

/** OpenF1 keeps adding results and pit data for a few hours after a session. Only cache settled sessions. */
const SETTLE_MS = 3 * 60 * 60_000;

export class NotReadyError extends Error {}
export class StorageFullError extends Error {}

/**
 * Vercel Blob on Hobby includes 1 GB and is suspended for 30 days if a limit is exceeded, so new
 * sessions are refused above this. One small manifest keeps a running estimate (one extra upload
 * per session rather than one per write).
 */
const CAP_BYTES = Number(process.env.STORE_CAP_MB ?? 900) * 1024 * 1024;
const MANIFEST = "manifest.json";
type Manifest = { bytes: number; sessions: Record<string, number> };
const estimateBytes = (windows: number) => 500_000 + windows * 700_000;

async function reserve(sessionKey: number, windows: number) {
  const manifest = (await readJson<Manifest>(MANIFEST)) ?? { bytes: 0, sessions: {} };
  if (manifest.sessions[sessionKey] !== undefined) return;
  const needed = estimateBytes(windows);
  if (manifest.bytes + needed > CAP_BYTES) {
    const mb = (n: number) => Math.round(n / 1024 / 1024);
    throw new StorageFullError(`Session storage is nearly full (${mb(manifest.bytes)} MB of ${mb(CAP_BYTES)} MB used), so new sessions cannot be downloaded. Already downloaded sessions still open.`);
  }
  manifest.sessions[sessionKey] = needed;
  manifest.bytes += needed;
  await writeJson(MANIFEST, manifest);
}

/** Learned marshal-sector positions committed in data/marshal-sectors. */
export async function learnedSectors(circuitKey: number): Promise<LearnedSectors | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "marshal-sectors", `${circuitKey}.json`), "utf8");
    const parsed = JSON.parse(raw) as { count?: number; observations: LearnedSectors["observations"] };
    return { count: parsed.count ?? null, observations: parsed.observations };
  } catch {
    return null;
  }
}

/**
 * MultiViewer circuit file, fetched once per circuit and year and kept in the store (the owner
 * approved fetch-and-cache on 2026-11-14). A missing file is cached as "none" so it is not asked for again.
 */
export async function multiviewerCircuit(meeting: Pick<Meeting, "circuit_key" | "circuit_info_url" | "year">): Promise<MultiViewerCircuit | null> {
  const key = `multiviewer/${meeting.circuit_key}-${meeting.year}.json`;
  const cached = await readJson<{ file: MultiViewerCircuit | null }>(key);
  if (cached) return cached.file;
  if (!meeting.circuit_info_url) return null;
  let parsed: MultiViewerCircuit | null = null;
  try {
    const res = await fetch(meeting.circuit_info_url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (res.ok) parsed = (await res.json()) as MultiViewerCircuit;
    else if (res.status !== 404) return null; // transient: try again next time
  } catch {
    return null;
  }
  await writeJson(key, { file: parsed, fetchedAt: new Date().toISOString() });
  return parsed;
}

async function timing(sessionKey: number) {
  const [laps, raceControl, results] = await Promise.all([
    openf1<Lap>("laps", { session_key: sessionKey }),
    openf1<RaceControl>("race_control", { session_key: sessionKey }),
    openf1<SessionResult>("session_result", { session_key: sessionKey }),
  ]);
  return { laps, raceControl, results };
}

/** Location rows for one driver over one lap, for the outline. */
async function lapTrace(sessionKey: number, lap: Lap) {
  const from = Date.parse(lap.date_start!) - 2000;
  const to = from + lap.lap_duration! * 1000 + 4000;
  return openf1<LocationRow>("location", {
    session_key: sessionKey,
    driver_number: lap.driver_number,
    "date>": new Date(from).toISOString(),
    "date<": new Date(to).toISOString(),
  });
}

/**
 * Downloads already running on this server instance, so a second request for the same item (a
 * second tab, or React running effects twice in development) waits for the first instead of
 * fetching everything from OpenF1 again.
 */
const running = new Map<string, Promise<unknown>>();
function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = running.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = work().finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

/** Step 1 of ingesting: everything except car telemetry, about 15 OpenF1 requests. */
export function ingestMeta(sessionKey: number): Promise<SessionMeta> {
  return once(`meta:${sessionKey}`, () => downloadMeta(sessionKey));
}

async function downloadMeta(sessionKey: number): Promise<SessionMeta> {
  const existing = await readJson<SessionMeta>(metaKey(sessionKey));
  if (existing) return existing;

  const [session] = await openf1<Session>("sessions", { session_key: sessionKey });
  if (!session) throw new Error(`OpenF1 has no session ${sessionKey}`);
  if (Date.parse(session.date_end) + SETTLE_MS > Date.now()) {
    throw new NotReadyError("This session ended less than three hours ago. OpenF1 is still adding results; try again later.");
  }
  // Check the storage cap before spending any more requests; size estimated from the schedule.
  const scheduledWindows = Math.ceil((Date.parse(session.date_end) - Date.parse(session.date_start) + 30 * 60_000) / WINDOW_MS);
  await reserve(sessionKey, scheduledWindows);
  const [[meeting], drivers, { laps, raceControl, results }, positions, pits] = await Promise.all([
    openf1<Meeting>("meetings", { meeting_key: session.meeting_key }),
    openf1<Driver>("drivers", { session_key: sessionKey }),
    timing(sessionKey),
    openf1<PositionRow>("position", { session_key: sessionKey }),
    openf1<PitRow>("pit", { session_key: sessionKey }),
  ]);
  const isRace = session.session_type === "Race";
  const intervals = isRace ? await openf1<IntervalRow>("intervals", { session_key: sessionKey }) : [];

  let qualifying: SessionMeta["qualifying"] = null;
  let qualifyingLaps: Lap[] = [];
  if (isRace) {
    const q = qualifyingFor(session, await openf1<Session>("sessions", { meeting_key: session.meeting_key }));
    if (q) {
      const t = await timing(q.session_key);
      qualifying = { sessionKey: q.session_key, sessionName: q.session_name, ...t };
      qualifyingLaps = t.laps;
    }
  }

  // Outline from this session's fastest lap; if this session has no position data for it
  // (Monaco 2026 race), from the qualifying session at the same circuit.
  let outline = null;
  let outlineNote = "No lap with position data was found to draw the circuit from.";
  const own = outlineLap(laps);
  if (own) outline = outlineFrom(own, await lapTrace(sessionKey, own));
  if (outline) outlineNote = `Drawn from #${own!.driver_number}'s lap ${own!.lap_number}.`;
  else if (qualifying) {
    const lap = outlineLap(qualifyingLaps);
    if (lap) outline = outlineFrom(lap, await lapTrace(qualifying.sessionKey, lap));
    if (outline) outlineNote = `This session has no position data for its laps; the circuit is drawn from ${qualifying.sessionName}.`;
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
    outlineNote,
    multiviewer: meeting ? await multiviewerCircuit(meeting) : null,
    learned: await learnedSectors(session.circuit_key),
    qualifying,
    source: "openf1",
  });
  await writeJson(metaKey(sessionKey), meta);
  return meta;
}

async function fetchRange<T>(endpoint: string, sessionKey: number, from: number, to: number, depth = 0): Promise<T[]> {
  try {
    return await openf1<T>(endpoint, { session_key: sessionKey, "date>=": new Date(from).toISOString(), "date<": new Date(to).toISOString() });
  } catch (e) {
    // OpenF1 rejects large ranges with 422; split and retry.
    if (!(e instanceof TooMuchDataError) || depth >= 4) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...(await fetchRange<T>(endpoint, sessionKey, from, mid, depth + 1)), ...(await fetchRange<T>(endpoint, sessionKey, mid, to, depth + 1))];
  }
}

/** Step 2..n: one 15-minute window of location and car data (2 requests, more if split). */
export function ingestWindow(meta: SessionMeta, index: number): Promise<TelemetryChunk> {
  return once(`chunk:${meta.session.session_key}:${index}`, () => downloadWindow(meta, index));
}

async function downloadWindow(meta: SessionMeta, index: number): Promise<TelemetryChunk> {
  const key = chunkKey(meta.session.session_key, index);
  const existing = await readJson<TelemetryChunk>(key);
  if (existing) return existing;
  const w = meta.windows[index];
  if (!w) throw new Error(`No window ${index}`);
  const location = await fetchRange<LocationRow>("location", meta.session.session_key, w.from, w.to);
  const carData = await fetchRange<CarDataRow>("car_data", meta.session.session_key, w.from, w.to);
  const chunk = encodeChunk(index, w.from, w.to, location, carData);
  await writeJson(key, chunk);
  return chunk;
}
