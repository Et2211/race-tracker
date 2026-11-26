import "server-only";
import { encodeChunk } from "@/lib/session/telemetry";
import type { TelemetryChunk } from "@/lib/session/types";
import { decodeBucket } from "./buckets";
import { statusView, type LiveStatusView } from "./http";
import { LIVE_PAGE, type LiveBucketRead, type LiveRowRead, type LiveStore } from "./store";
import type { Tick } from "./sync";

/** Seconds of car data (and the records changed meanwhile) in the shared tick. */
export const TICK_WINDOW_S = 10;
/**
 * Seconds of car data in one answer (about 5 KB each). After a relay fills a gap, hundreds of
 * seconds change at once; those go out in answers of this size, one after another.
 */
export const TICK_BUCKETS = 30;
/**
 * A server instance answers the shared tick from memory for this long. The CDN asks once a
 * second per region; without this, every region would read the whole window from Supabase.
 */
export const MEMO_MS = 500;

/** One stored second as a telemetry piece the dashboard loads like a stored session's window. */
export function piece(second: number, data: string): TelemetryChunk {
  const b = decodeBucket(second, data);
  return encodeChunk(second, second * 1000, (second + 1) * 1000, b.location, b.carData);
}

type Status = LiveStatusView;

function tickOf(from: number, head: number, top: number, rows: LiveRowRead[], seconds: LiveBucketRead[], status: Status): Tick<Status> {
  return {
    from,
    head,
    more: head < top,
    rows: rows.filter((r) => r.rev <= head).sort((a, b) => a.rev - b.rev).map(({ topic, payload, rev }) => ({ topic, payload, rev })),
    chunks: seconds.filter((b) => b.rev <= head).sort((a, b) => a.rev - b.rev).map((b) => ({ rev: b.rev, chunk: piece(b.second, b.data) })),
    status,
  };
}

/** The changes in (`from`, head] as stored now, a page at most; `top` is the newest revision in `status`. */
async function readTick(store: LiveStore, sessionKey: number, from: number, status: Status, buckets: number) {
  const top = Math.max(status.lastRev, status.lastBucketRev);
  if (from >= top) return { tick: tickOf(from, from, top, [], [], status), rows: [], seconds: [] };
  const [rows, seconds] = await Promise.all([store.rowsSince(sessionKey, from), store.bucketsSince(sessionKey, from, buckets)]);
  // A full page covers only up to its last revision; the rest waits for `?after=<head>`.
  let head = top;
  if (rows.length === LIVE_PAGE) head = Math.min(head, rows[rows.length - 1].rev);
  if (seconds.length === buckets) head = Math.min(head, seconds[seconds.length - 1].rev);
  return { tick: tickOf(from, head, top, rows, seconds, status), rows, seconds };
}

/**
 * The changes in (`after`, head], or without `after` in the last TICK_WINDOW_S seconds. Where the
 * window starts is read before the newest revision, so it can never lie past it.
 */
export async function buildTick(store: LiveStore, sessionKey: number, after: number | null, buckets = TICK_BUCKETS): Promise<Tick<Status>> {
  const from = after ?? (await store.windowStart(sessionKey, TICK_WINDOW_S));
  return (await readTick(store, sessionKey, from, await statusView(sessionKey, store), buckets)).tick;
}

/**
 * What one server instance holds of a session's window: the newest version of every record and
 * second changed in (`floor`, `head`], so each new tick reads from Supabase only what changed
 * since. A record changed again replaces its older version, as it does in the store.
 */
type Held = { floor: number; head: number; rows: Map<string, LiveRowRead>; seconds: Map<number, LiveBucketRead> };
// Per session: every store object in a process reads the same data (Supabase, or the one memory store).
const held = new Map<number, Held>();
const memo = new Map<number, { at: number; tick: Promise<Tick<Status>> }>();

function hold(h: Held, rows: LiveRowRead[], seconds: LiveBucketRead[], top: number) {
  for (const r of rows) {
    const id = `${r.topic}|${r.key}`;
    if (r.rev <= top && r.rev > (h.rows.get(id)?.rev ?? -1)) h.rows.set(id, r);
  }
  for (const b of seconds) if (b.rev <= top && b.rev > (h.seconds.get(b.second)?.rev ?? -1)) h.seconds.set(b.second, b);
  h.head = Math.max(h.head, top);
}

async function windowTick(store: LiveStore, sessionKey: number, buckets: number): Promise<Tick<Status>> {
  const key = sessionKey;
  const from = await store.windowStart(sessionKey, TICK_WINDOW_S);
  const status = await statusView(sessionKey, store);
  const top = Math.max(status.lastRev, status.lastBucketRev);
  const h = held.get(key);
  if (h && h.floor <= from && h.head <= top) {
    const [rows, seconds] = await Promise.all([store.rowsSince(sessionKey, h.head), store.bucketsSince(sessionKey, h.head, buckets)]);
    if (rows.length < LIVE_PAGE && seconds.length < buckets) {
      hold(h, rows, seconds, top);
      for (const [id, r] of h.rows) if (r.rev <= from) h.rows.delete(id);
      for (const [s, b] of h.seconds) if (b.rev <= from) h.seconds.delete(s);
      h.floor = Math.max(h.floor, from);
      return tickOf(from, top, top, [...h.rows.values()], [...h.seconds.values()], status);
    }
  }
  // Nothing held yet, the window moved past what is held, or too much changed at once: read it whole.
  const read = await readTick(store, sessionKey, from, status, buckets);
  if (read.tick.more) held.delete(key);
  else {
    const fresh: Held = { floor: from, head: from, rows: new Map(), seconds: new Map() };
    hold(fresh, read.rows, read.seconds, read.tick.head);
    held.set(key, fresh);
  }
  return read.tick;
}

/** The shared tick without `after`: answered from what this instance holds, at most MEMO_MS old. */
export function sharedTick(store: LiveStore, sessionKey: number, buckets = TICK_BUCKETS): Promise<Tick<Status>> {
  const key = sessionKey;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.tick;
  const tick = windowTick(store, sessionKey, buckets);
  memo.set(key, { at: Date.now(), tick });
  tick.catch(() => memo.delete(key));
  return tick;
}
