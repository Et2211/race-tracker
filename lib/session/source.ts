import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { openf1 } from "@/lib/openf1/client";
import type { Meeting, Session } from "@/lib/openf1/types";
import { sessionIndex } from "@/lib/storage/session-index";
import { getStore, readJson, writeJson } from "@/lib/storage/store";
import type { MultiViewerCircuit } from "@/lib/track/markers";
import { PICKER_SESSIONS, type Catalog } from "./catalog";
import { fixtureChunk, fixtureMeetings, fixtureMeta, fixtureSessions } from "./fixtures";
import { marshalSectors } from "./assemble";
import { chunkKey, ingestMeta, ingestWindow, learnedSectors, metaKey } from "./ingest";
import type { SessionMeta, TelemetryChunk } from "./types";

/** "fixtures" serves only the recorded sessions and never touches the network. */
export const dataMode = (): "openf1" | "fixtures" => (process.env.F1_DATA_MODE === "fixtures" ? "fixtures" : "openf1");

const SETTLE_MS = 3 * 60 * 60_000;
const CURRENT_YEAR_TTL_MS = 6 * 60 * 60_000;

function buildCatalog(year: number, meetings: Meeting[], sessions: Session[], source: Catalog["source"]): Catalog {
  const now = Date.now();
  return {
    year,
    source,
    fetchedAt: new Date().toISOString(),
    meetings: meetings
      .filter((m) => !/testing/i.test(m.meeting_name))
      .map((m) => ({
        meetingKey: m.meeting_key,
        name: m.meeting_name,
        circuit: m.circuit_short_name,
        dateStart: m.date_start,
        sessions: sessions
          .filter((s) => s.meeting_key === m.meeting_key && PICKER_SESSIONS.includes(s.session_name) && !s.is_cancelled)
          .filter((s) => Date.parse(s.date_start) < now)
          .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))
          .map((s) => ({ sessionKey: s.session_key, name: s.session_name, type: s.session_type, dateStart: s.date_start, dateEnd: s.date_end, available: Date.parse(s.date_end) + SETTLE_MS < now, downloaded: false })),
      }))
      .filter((m) => m.sessions.length > 0)
      .sort((a, b) => a.dateStart.localeCompare(b.dateStart)),
  };
}

export async function getCatalog(year: number): Promise<Catalog> {
  if (dataMode() === "fixtures") {
    const sessions = (await fixtureSessions()).filter((s) => s.year === year);
    const catalog = buildCatalog(year, (await fixtureMeetings()).filter((m) => m.year === year), sessions, "fixtures");
    for (const m of catalog.meetings) for (const s of m.sessions) s.downloaded = true;
    return catalog;
  }
  const catalog = await cachedCatalog(year);
  // Which sessions are downloaded changes all the time, so it is added per request, not cached.
  const downloaded = await sessionIndex().complete();
  for (const m of catalog.meetings) for (const s of m.sessions) s.downloaded = downloaded.has(s.sessionKey);
  return catalog;
}

async function cachedCatalog(year: number): Promise<Catalog> {
  const key = `catalog/${year}.json`;
  const cached = await readJson<Catalog>(key);
  const finishedYear = year < new Date().getUTCFullYear();
  if (cached && (finishedYear || Date.now() - Date.parse(cached.fetchedAt) < CURRENT_YEAR_TTL_MS)) return cached;
  const [meetings, sessions] = await Promise.all([openf1<Meeting>("meetings", { year }), openf1<Session>("sessions", { year })]);
  const catalog = buildCatalog(year, meetings, sessions, "openf1");
  await writeJson(key, catalog);
  return catalog;
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
  const meta = await readJson<SessionMeta>(metaKey(sessionKey));
  if (!meta) throw new Error("Load the session's metadata first");
  return ingestWindow(meta, index);
}
