import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { openf1, TooMuchDataError } from "@/lib/openf1/client";
import type { CarDataRow, Driver, IntervalRow, Lap, LocationRow, Meeting, PitRow, PositionRow, RaceControl, Session, SessionResult, Stint } from "@/lib/openf1/types";
import { withDownloadLock } from "@/lib/storage/download-lock";
import { downloadLocks } from "@/lib/storage/locks";
import { sessionIndex } from "@/lib/storage/session-index";
import { readJson, writeJson } from "@/lib/storage/store";
import { supabase, supabaseConfigured } from "@/lib/storage/supabase";
import type { MultiViewerCircuit } from "@/lib/track/markers";
import { assembleMeta, outlineFrom, outlineLap, qualifyingFor, WINDOW_MS, type LearnedSectors } from "./assemble";
import { replayAfter, SETTLE_MS } from "./catalog";
import { circuitShape, summarize, type CircuitShape } from "./summary";
import { encodeChunk } from "./telemetry";
import { sessionKind, type SessionMeta, type TelemetryChunk } from "./types";

export const metaKey = (sessionKey: number) => `sessions/${sessionKey}/meta.json`;

/** A stored session's circuit outline, to draw a session that has none of its own on. */
export type ReferenceOutline = { outline: NonNullable<SessionMeta["outline"]>; year: number; sessionName: string };
const referenceCache = new Map<number, { at: number; value: Promise<ReferenceOutline | null> }>();

/**
 * The outline of the newest stored session at this circuit, other than `except`: for a live
 * session (the feed has no outline), and for one with no usable lap of its own (a wet practice
 * where hardly anyone set a timed lap). Kept for 10 minutes per server instance: each read is a
 * multi-MB file.
 */
export function referenceOutline(circuitKey: number, except: number): Promise<ReferenceOutline | null> {
  const hit = referenceCache.get(circuitKey);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const value = (async () => {
    for (const key of await sessionIndex().atCircuit(circuitKey).catch(() => [] as number[])) {
      if (key === except) continue;
      const meta = await readJson<SessionMeta>(metaKey(key));
      if (meta?.outline) return { outline: meta.outline, year: meta.session.year, sessionName: meta.session.session_name };
    }
    return null;
  })();
  referenceCache.set(circuitKey, { at: Date.now(), value });
  return value;
}
export const summaryKey = (sessionKey: number) => `sessions/${sessionKey}/summary.json`;
export const circuitKeyPath = (circuitKey: number) => `circuits/${circuitKey}.json`;

/**
 * Small files derived from a session's metadata for the homepage: its summary, and the circuit's
 * outline (the newest season's drawing wins). Returns the bytes written.
 */
export async function writeDerived(meta: SessionMeta): Promise<number> {
  let bytes = await writeJson(summaryKey(meta.session.session_key), summarize(meta));
  const shape = circuitShape(meta);
  if (shape) {
    const existing = await readJson<CircuitShape>(circuitKeyPath(shape.circuitKey));
    if (!existing || existing.year <= shape.year) bytes += await writeJson(circuitKeyPath(shape.circuitKey), shape);
  }
  return bytes;
}
export const chunkKey = (sessionKey: number, index: number) => `sessions/${sessionKey}/chunk-${index}.json`;

/**
 * Practice is kept only for a while (see practice-store.ts): in its own folder, outside the
 * session index and the storage cap, so it never shows as downloaded or serves as a circuit's
 * reference outline, and the daily job can clear it with one listing.
 */
export const practiceMetaKey = (sessionKey: number) => `practice/${sessionKey}-meta.json`;
export const practiceChunkKey = (sessionKey: number, index: number) => `practice/${sessionKey}-chunk-${index}.json`;
/** Practice is kept only once OpenF1 has settled; before that every opening builds it afresh. */
const keepPractice = (session: { date_end: string }) => Date.parse(session.date_end) + SETTLE_MS < Date.now();
const readMeta = async (sessionKey: number) => (await readJson<SessionMeta>(metaKey(sessionKey))) ?? (await readJson<SessionMeta>(practiceMetaKey(sessionKey)));

/**
 * A stored session's metadata, kept for 10 minutes per server instance: downloading its windows
 * one request at a time needs it each time, and it is a multi-MB file.
 */
const metaMemo = new Map<number, { at: number; meta: Promise<SessionMeta | null> }>();
export function storedSessionMeta(sessionKey: number): Promise<SessionMeta | null> {
  const hit = metaMemo.get(sessionKey);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.meta;
  const meta = readMeta(sessionKey);
  metaMemo.set(sessionKey, { at: Date.now(), meta });
  meta.then((m) => {
    if (!m) metaMemo.delete(sessionKey); // not stored yet: ask again next time
  });
  return meta;
}


export class NotReadyError extends Error {}
/**
 * Practice is never stored (owner's decision): opening one builds it from OpenF1 and sends it
 * straight to the browser. The metadata is kept here for 10 minutes so its telemetry windows,
 * requested one after another, do not rebuild it each time.
 */
const practiceMemo = new Map<number, { at: number; meta: SessionMeta }>();
export function rememberedPractice(sessionKey: number): SessionMeta | null {
  const hit = practiceMemo.get(sessionKey);
  return hit && Date.now() - hit.at < 10 * 60_000 ? hit.meta : null;
}

/** Learned marshal-sector positions: the Supabase table when configured, else data/marshal-sectors. */
export async function learnedSectors(circuitKey: number): Promise<LearnedSectors | null> {
  if (supabaseConfigured()) {
    const { data, error } = await supabase().from("marshal_observations").select("sector, arc_dm, session_key").eq("circuit_key", circuitKey);
    if (error) throw error;
    if (!data.length) return null;
    const observations: LearnedSectors["observations"] = {};
    for (const row of data) (observations[row.sector] ??= []).push({ arc: row.arc_dm, session_key: row.session_key });
    return { count: null, observations };
  }
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
 * fetching everything from OpenF1 again. Across instances, `withDownloadLock` does the same.
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
  const practice = rememberedPractice(sessionKey);
  if (practice) return Promise.resolve(practice);
  const key = `meta:${sessionKey}`;
  // A metadata download takes about a minute. The lock is renewed while it runs, so a crashed
  // holder is noticed within a minute; a waiter gives up after 150 s, leaving time for a full
  // download of its own inside the 300 s function limit.
  return once(key, () =>
    withDownloadLock(downloadLocks(), key, () => readMeta(sessionKey), () => downloadMeta(sessionKey), { ttlSeconds: 60, waitMs: 150_000 }),
  );
}

async function downloadMeta(sessionKey: number): Promise<SessionMeta> {
  const existing = await readMeta(sessionKey);
  if (existing) return existing;
  console.info(`[download] session ${sessionKey}: metadata`);

  const [session] = await openf1<Session>("sessions", { session_key: sessionKey });
  if (!session) throw new Error(`OpenF1 has no session ${sessionKey}`);
  // Practice is kept for a while in its own folder (practice-store.ts): no space reserved or counted.
  const keep = sessionKind(session) !== "practice";
  if (Date.parse(session.date_end) + replayAfter(!keep) > Date.now()) {
    throw new NotReadyError(`This session's replay opens ${keep ? "three hours" : "30 minutes"} after it ends, once OpenF1 has its results. Try again then.`);
  }
  // Check the storage cap before spending any more requests; size estimated from the schedule.
  const [meeting] = await openf1<Meeting>("meetings", { meeting_key: session.meeting_key });
  if (keep) await sessionIndex().reserve({
    sessionKey,
    year: session.year,
    meetingName: meeting?.meeting_name ?? session.circuit_short_name,
    sessionName: session.session_name,
    circuitKey: session.circuit_key,
    windows: Math.ceil((Date.parse(session.date_end) - Date.parse(session.date_start) + 30 * 60_000) / WINDOW_MS),
  });
  const [drivers, { laps, raceControl, results }, positions, pits] = await Promise.all([
    openf1<Driver>("drivers", { session_key: sessionKey }),
    timing(sessionKey),
    openf1<PositionRow>("position", { session_key: sessionKey }),
    openf1<PitRow>("pit", { session_key: sessionKey }),
  ]);
  const isRace = session.session_type === "Race";
  const intervals = isRace ? await openf1<IntervalRow>("intervals", { session_key: sessionKey }) : [];
  const stints = isRace ? await openf1<Stint>("stints", { session_key: sessionKey }) : undefined;

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
  if (!outline) {
    const reference = await referenceOutline(session.circuit_key, sessionKey);
    if (reference) {
      outline = reference.outline;
      outlineNote = `No usable lap in this session; drawn from the ${reference.year} ${reference.sessionName.toLowerCase()} here.`;
    }
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
    stints,
    results,
    outline,
    outlineNote,
    multiviewer: meeting ? await multiviewerCircuit(meeting) : null,
    learned: await learnedSectors(session.circuit_key),
    qualifying,
    source: "openf1",
  });
  if (!keep) {
    practiceMemo.set(sessionKey, { at: Date.now(), meta });
    // Kept so the next viewer, on any server, doesn't download it again; a failed write only costs that.
    if (keepPractice(session)) await writeJson(practiceMetaKey(sessionKey), meta).catch((e: unknown) => console.warn(`[download] session ${sessionKey}: practice not kept: ${e instanceof Error ? e.message : e}`));
    return meta;
  }
  const bytes = await writeJson(metaKey(sessionKey), meta);
  await sessionIndex().setWindows(sessionKey, meta.windows.length);
  await sessionIndex().added(sessionKey, bytes + (await writeDerived(meta)), false);
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
  const key = `chunk:${meta.session.session_key}:${index}`;
  return once(key, () =>
    withDownloadLock(downloadLocks(), key, () => readChunk(meta, index), () => downloadWindow(meta, index), {
      ttlSeconds: 60,
      waitMs: 150_000,
    }),
  );
}

const readChunk = (meta: SessionMeta, index: number) =>
  readJson<TelemetryChunk>(meta.kind === "practice" ? practiceChunkKey(meta.session.session_key, index) : chunkKey(meta.session.session_key, index));

async function downloadWindow(meta: SessionMeta, index: number): Promise<TelemetryChunk> {
  const key = chunkKey(meta.session.session_key, index);
  const keep = meta.kind !== "practice"; // practice: kept for a while in its own folder, not counted
  const existing = await readChunk(meta, index);
  if (existing) return existing;
  const w = meta.windows[index];
  if (!w) throw new Error(`No window ${index}`);
  // Both at once: OpenF1 takes seconds to answer each, and the shared schedule keeps the pace.
  const [location, carData] = await Promise.all([
    fetchRange<LocationRow>("location", meta.session.session_key, w.from, w.to),
    fetchRange<CarDataRow>("car_data", meta.session.session_key, w.from, w.to),
  ]);
  const chunk = encodeChunk(index, w.from, w.to, location, carData);
  if (!keep) {
    if (keepPractice(meta.session)) await writeJson(practiceChunkKey(meta.session.session_key, index), chunk).catch((e: unknown) => console.warn(`[download] session ${meta.session.session_key}: practice window ${index} not kept: ${e instanceof Error ? e.message : e}`));
    return chunk;
  }
  const bytes = await writeJson(key, chunk);
  await sessionIndex().added(meta.session.session_key, bytes, true);
  return chunk;
}
