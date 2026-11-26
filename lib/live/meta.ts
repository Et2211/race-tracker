import "server-only";
import { openf1Live } from "@/lib/openf1/client";
import type { Meeting, Session } from "@/lib/openf1/types";
import { assembleMeta, qualifyingFor } from "@/lib/session/assemble";
import { learnedSectors, metaKey, multiviewerCircuit, referenceOutline } from "@/lib/session/ingest";
import type { SessionMeta } from "@/lib/session/types";
import { readJson } from "@/lib/storage/store";
import { mergeLiveRows } from "./merge";
import { LIVE_PAGE, type LiveStore } from "./store";

/** The session's schedule and meeting, fetched once per server instance; a failure is remembered for a minute. */
const infoCache = new Map<number, Promise<{ session: Session; meeting: Meeting; meetingSessions: Session[] }>>();
function sessionInfo(sessionKey: number) {
  let p = infoCache.get(sessionKey);
  if (!p) {
    p = (async () => {
      const [session] = await openf1Live<Session>("sessions", { session_key: sessionKey });
      if (!session) throw new Error(`OpenF1 has no session ${sessionKey}`);
      const [[meeting], meetingSessions] = await Promise.all([openf1Live<Meeting>("meetings", { meeting_key: session.meeting_key }), openf1Live<Session>("sessions", { meeting_key: session.meeting_key })]);
      return { session, meeting: meeting ?? ({ meeting_key: session.meeting_key, meeting_name: session.circuit_short_name, circuit_key: session.circuit_key, year: session.year } as unknown as Meeting), meetingSessions };
    })();
    p.catch(() => setTimeout(() => infoCache.delete(sessionKey), 60_000));
    infoCache.set(sessionKey, p);
  }
  return p;
}

/** Things read from stored sessions, kept for 10 minutes per server instance: each is a multi-MB file. */
const stored = new Map<string, { at: number; value: Promise<unknown> }>();
function remembered<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = stored.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value as Promise<T>;
  const value = load();
  stored.set(key, { at: Date.now(), value });
  return value;
}

/** The stored qualifying session that set this race's grid, as timing only. */
function qualifyingTiming(sessionKey: number): Promise<SessionMeta["qualifying"]> {
  return remembered(`qualifying:${sessionKey}`, async () => {
    const q = await readJson<SessionMeta>(metaKey(sessionKey));
    return q ? { sessionKey: q.session.session_key, sessionName: q.session.session_name, laps: q.laps, raceControl: q.raceControl, results: q.results } : null;
  });
}

/** Reads every row the relays have stored for a session, oldest change first. */
async function allRows(store: LiveStore, sessionKey: number) {
  const out = [];
  let rev = 0;
  for (;;) {
    const page = await store.rowsSince(sessionKey, rev);
    out.push(...page);
    if (page.length < LIVE_PAGE) break;
    rev = page[page.length - 1].rev;
  }
  return { rows: out, rev: out.length ? Math.max(...out.map((r) => r.rev)) : 0 };
}

/**
 * A live session's metadata as far as the feed has got. The track outline and marshal sectors
 * come from the newest stored session at the circuit (said so in `outlineNote`); there is no
 * classification until results are published, so retired cars stay on the map until then.
 */
export async function liveMeta(store: LiveStore, sessionKey: number): Promise<{ meta: SessionMeta; rev: number }> {
  const [{ session, meeting, meetingSessions }, { rows, rev }] = await Promise.all([sessionInfo(sessionKey), allRows(store, sessionKey)]);
  const reference = await referenceOutline(session.circuit_key, sessionKey);
  const q = qualifyingFor(session, meetingSessions);
  const base = assembleMeta({
    session,
    meeting,
    drivers: [],
    laps: [],
    raceControl: [],
    positions: [],
    intervals: [],
    pits: [],
    stints: [],
    results: [],
    outline: reference?.outline ?? null,
    outlineNote: reference
      ? `Drawn from the ${reference.year} ${reference.sessionName.toLowerCase()} here (the live feed has no outline).`
      : "No stored session at this circuit to draw it from yet.",
    multiviewer: await multiviewerCircuit(meeting).catch(() => null),
    learned: await learnedSectors(session.circuit_key).catch(() => null),
    qualifying: q ? await qualifyingTiming(q.session_key) : null,
    source: "live",
  });
  base.windows = [];
  return { meta: mergeLiveRows(base, rows), rev };
}
