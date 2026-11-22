import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { openf1 } from "@/lib/openf1/client";
import type { Meeting, Session } from "@/lib/openf1/types";
import { sessionIndex } from "@/lib/storage/session-index";
import { getStore, readJson, writeJson } from "@/lib/storage/store";
import type { CircuitCorners } from "@/lib/driver/corners";
import type { MultiViewerCircuit } from "@/lib/track/markers";
import { buildCatalog, withStatus, type Catalog } from "./catalog";
import { fixtureChunk, fixtureMeetings, fixtureMeta, fixtureSessions } from "./fixtures";
import { marshalSectors } from "./assemble";
import { chunkKey, ingestMeta, ingestWindow, learnedSectors, metaKey, multiviewerCircuit, storedSessionMeta } from "./ingest";
import type { SessionMeta, TelemetryChunk } from "./types";

/** "fixtures" serves only the recorded sessions and never touches the network. */
export const dataMode = (): "openf1" | "fixtures" => (process.env.F1_DATA_MODE === "fixtures" ? "fixtures" : "openf1");

const CURRENT_YEAR_TTL_MS = 6 * 60 * 60_000;

export async function getCatalog(year: number, downloadedSet?: Set<number>): Promise<Catalog> {
  if (dataMode() === "fixtures") {
    const sessions = (await fixtureSessions()).filter((s) => s.year === year);
    return withStatus(buildCatalog(year, (await fixtureMeetings()).filter((m) => m.year === year), sessions, "fixtures"), () => true);
  }
  const catalog = await cachedCatalog(year);
  // What is downloaded, started or final changes all the time, so it is worked out per request.
  const downloaded = downloadedSet ?? (await sessionIndex().complete());
  return withStatus(catalog, (key) => downloaded.has(key));
}


async function cachedCatalog(year: number): Promise<Catalog> {
  // v4: lists practice sessions (live only), sessions that have not started yet, and cancelled rounds.
  const key = `catalog/v4/${year}.json`;
  const cached = await readJson<Catalog>(key);
  // A season's list is final only if it was fetched after the season ended (late changes included).
  const final = cached !== null && Date.parse(cached.fetchedAt) >= Date.UTC(year + 1, 0, 1);
  if (cached && (final || Date.now() - Date.parse(cached.fetchedAt) < CURRENT_YEAR_TTL_MS)) return cached;
  try {
    const [meetings, sessions] = await Promise.all([openf1<Meeting>("meetings", { year }), openf1<Session>("sessions", { year })]);
    const catalog = buildCatalog(year, meetings, sessions, "openf1");
    await writeJson(key, catalog);
    return catalog;
  } catch (e) {
    // OpenF1 down or rate-limiting: an older list is better than none (it is refreshed next time).
    if (cached) return cached;
    throw e;
  }
}

async function fixtureExtras(sessionKey: number) {
  // The fixture's MultiViewer file is used only if the store already has it; fixture mode makes no requests.
  const sessions = await fixtureSessions();
  const s = sessions.find((x) => x.session_key === sessionKey);
  if (!s) return { multiviewer: null, learned: null };
  const cached = await readJson<{ file: MultiViewerCircuit | null }>(`multiviewer/${s.circuit_key}-${s.year}.json`);
  return { multiviewer: cached?.file ?? null, learned: await learnedSectors(s.circuit_key) };
}

/** Gzipped JSON of an ingested session's metadata, or null if not ingested yet. */
export async function storedMeta(sessionKey: number): Promise<Buffer | null> {
  if (dataMode() === "fixtures") {
    const meta = await fixtureMeta(sessionKey, await fixtureExtras(sessionKey));
    return meta ? gzipSync(JSON.stringify(meta)) : null;
  }
  const raw = await getStore().getRaw(metaKey(sessionKey));
  if (!raw) return null;
  const meta = JSON.parse(gunzipSync(raw).toString("utf8")) as SessionMeta;
  if (meta.marshal.source === "multiviewer") return raw;
  // Learned sector positions grow after a session is stored; apply the current ones.
  const learned = await learnedSectors(meta.session.circuit_key);
  if (!learned) return raw;
  meta.marshal = marshalSectors(meta.outline, null, learned, meta.session.session_key);
  return gzipSync(JSON.stringify(meta));
}

export async function storedChunk(sessionKey: number, index: number): Promise<Buffer | null> {
  if (dataMode() === "fixtures") {
    const chunk = await fixtureChunk(sessionKey, index);
    return chunk ? gzipSync(JSON.stringify(chunk)) : null;
  }
  return getStore().getRaw(chunkKey(sessionKey, index));
}

export async function ensureMeta(sessionKey: number): Promise<SessionMeta> {
  if (dataMode() === "fixtures") {
    const raw = await storedMeta(sessionKey);
    if (!raw) throw new Error(`Session ${sessionKey} is not among the recorded fixtures`);
    return JSON.parse(gunzipSync(raw).toString("utf8")) as SessionMeta;
  }
  return ingestMeta(sessionKey);
}

export async function ensureChunk(sessionKey: number, index: number): Promise<TelemetryChunk> {
  if (dataMode() === "fixtures") {
    const raw = await storedChunk(sessionKey, index);
    if (!raw) throw new Error(`No recorded window ${index} for session ${sessionKey}`);
    return JSON.parse(gunzipSync(raw).toString("utf8")) as TelemetryChunk;
  }
  // Stored metadata, or (practice, never stored) the copy built for this viewer a moment ago.
  const meta = (await storedSessionMeta(sessionKey)) ?? (await ingestMeta(sessionKey));
  return ingestWindow(meta, index);
}


/**
 * Corners for a session's circuit, from the MultiViewer file the session's marshal sectors come
 * from (fetched once per circuit and year, then kept). Served on their own so stored sessions need
 * no change. The meeting comes from the stored session, else from OpenF1 (a live session).
 */
export async function circuitCorners(sessionKey: number): Promise<{ corners: CircuitCorners; final: boolean }> {
  let file: MultiViewerCircuit | null = null;
  // "No file" is final only when it is what the store has on record, not a fetch that just failed.
  let final = true;
  if (dataMode() === "fixtures") {
    file = (await fixtureExtras(sessionKey)).multiviewer;
  } else {
    const raw = await getStore().getRaw(metaKey(sessionKey));
    let meeting: Meeting | null = raw ? (JSON.parse(gunzipSync(raw).toString("utf8")) as SessionMeta).meeting : null;
    if (!meeting) {
      const [session] = await openf1<Session>("sessions", { session_key: sessionKey });
      if (session) [meeting] = await openf1<Meeting>("meetings", { meeting_key: session.meeting_key });
    }
    file = meeting ? await multiviewerCircuit(meeting) : null;
    if (!file && meeting) final = (await readJson(`multiviewer/${meeting.circuit_key}-${meeting.year}.json`)) !== null;
  }
  const corners = (file?.corners ?? []).map((c) => ({ number: c.number, x: c.trackPosition.x, y: c.trackPosition.y }));
  return { corners: corners.length ? { source: "multiviewer", year: file?.year ?? null, corners } : { source: "none" }, final };
}
