import "server-only";
import { openf1 } from "@/lib/openf1/client";
import type { Meeting, Session } from "@/lib/openf1/types";
import { assembleMeta, qualifyingFor } from "@/lib/session/assemble";
import { learnedSectors, metaKey, multiviewerCircuit } from "@/lib/session/ingest";
import type { SessionMeta } from "@/lib/session/types";
import { sessionIndex } from "@/lib/storage/session-index";
import { readJson } from "@/lib/storage/store";
import { mergeLiveRows } from "./merge";
import { LIVE_PAGE, type LiveStore } from "./store";

/** The session's schedule and meeting, fetched once per server instance. */
const infoCache = new Map<number, Promise<{ session: Session; meeting: Meeting; meetingSessions: Session[] }>>();
function sessionInfo(sessionKey: number) {
  let p = infoCache.get(sessionKey);
  if (!p) {
    p = (async () => {
      const [session] = await openf1<Session>("sessions", { session_key: sessionKey });
      if (!session) throw new Error(`OpenF1 has no session ${sessionKey}`);
      const [[meeting], meetingSessions] = await Promise.all([openf1<Meeting>("meetings", { meeting_key: session.meeting_key }), openf1<Session>("sessions", { meeting_key: session.meeting_key })]);
      return { session, meeting: meeting ?? ({ meeting_key: session.meeting_key, meeting_name: session.circuit_short_name, circuit_key: session.circuit_key, year: session.year } as unknown as Meeting), meetingSessions };
    })();
    p.catch(() => infoCache.delete(sessionKey));
    infoCache.set(sessionKey, p);
  }
  return p;
}

/** The newest stored session at this circuit that has an outline: the live map is drawn on it. */
async function referenceSession(circuitKey: number, except: number): Promise<SessionMeta | null> {
  for (const key of await sessionIndex().atCircuit(circuitKey).catch(() => [] as number[])) {
    if (key === except) continue;
    const meta = await readJson<SessionMeta>(metaKey(key));
    if (meta?.outline) return meta;
  }
  return null;
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
  const reference = await referenceSession(session.circuit_key, sessionKey);
  const q = qualifyingFor(session, meetingSessions);
  const qualifyingMeta = q ? await readJson<SessionMeta>(metaKey(q.session_key)) : null;
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
      ? `Drawn from the ${reference.session.year} ${reference.session.session_name.toLowerCase()} here (the live feed has no outline).`
      : "No stored session at this circuit to draw it from yet.",
    multiviewer: await multiviewerCircuit(meeting).catch(() => null),
    learned: await learnedSectors(session.circuit_key).catch(() => null),
    qualifying: qualifyingMeta
      ? { sessionKey: qualifyingMeta.session.session_key, sessionName: qualifyingMeta.session.session_name, laps: qualifyingMeta.laps, raceControl: qualifyingMeta.raceControl, results: qualifyingMeta.results }
      : null,
    source: "live",
  });
  base.windows = [];
  return { meta: mergeLiveRows(base, rows), rev };
}
