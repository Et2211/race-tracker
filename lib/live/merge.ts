import type { Session } from "@/lib/openf1/types";
import { ownRaceControl, runningSpan } from "@/lib/session/assemble";
import type { SessionMeta } from "@/lib/session/types";
import { isRowTopic, rowKey, type RowTopic } from "./topics";

/** Where each topic's rows live in a session's metadata. Weather and the starting grid are kept but not shown yet. */
const FIELD = {
  drivers: "drivers",
  laps: "laps",
  race_control: "raceControl",
  position: "positions",
  intervals: "intervals",
  pit: "pits",
  stints: "stints",
  session_result: "results",
} as const satisfies Partial<Record<RowTopic, keyof SessionMeta>>;
type Field = (typeof FIELD)[keyof typeof FIELD];

export type LiveRow = { topic: string; payload: Record<string, unknown> };

/** Per merged array: where each record sits, so the next merge does not have to rebuild it. */
const positions = new WeakMap<object, Map<string, number>>();

function indexOf(topic: RowTopic, rows: Record<string, unknown>[]): Map<string, number> {
  let index = positions.get(rows);
  if (!index) {
    index = new Map();
    rows.forEach((row, i) => index!.set(rowKey(topic, row) ?? `#${i}`, i));
  }
  return index;
}

/** Sort order of a topic's rows, or null where order does not matter. */
const ORDER: Partial<Record<RowTopic, (a: Record<string, unknown>, b: Record<string, unknown>) => number>> = {
  position: (a, b) => Date.parse(a.date as string) - Date.parse(b.date as string),
  intervals: (a, b) => Date.parse(a.date as string) - Date.parse(b.date as string),
  laps: (a, b) => (a.lap_number as number) - (b.lap_number as number) || (a.driver_number as number) - (b.driver_number as number),
};

/**
 * Folds rows from the live feed into a session: a row replaces the one with the same identity
 * (a lap gaining its sector times, say), others are added. Only the arrays of topics that
 * changed are replaced (so memos keyed on the others hold), new rows are appended in place when
 * they come in order (the usual case), and the schedule-derived span is recomputed only when
 * laps, race control or the session changed. Returns a new object, so React sees the change.
 */
export function mergeLiveRows(meta: SessionMeta, rows: LiveRow[]): SessionMeta {
  if (rows.length === 0) return meta;
  const groups = new Map<RowTopic, Record<string, unknown>[]>();
  for (const r of rows) {
    if (!isRowTopic(r.topic)) continue;
    const list = groups.get(r.topic) ?? [];
    list.push(r.payload);
    groups.set(r.topic, list);
  }
  if (groups.size === 0) return meta;
  const next: SessionMeta = { ...meta };
  const session = groups.get("sessions")?.find((s) => s.session_key === meta.session.session_key);
  if (session) next.session = { ...meta.session, ...(session as Partial<Session>) };
  for (const [topic, payloads] of groups) {
    if (!(topic in FIELD)) continue;
    const field = FIELD[topic as keyof typeof FIELD] as Field;
    const current = (next[field] as unknown as Record<string, unknown>[] | undefined) ?? [];
    // A copy: the same update can run twice on the same input (React's StrictMode does).
    const index = new Map(indexOf(topic, current));
    const merged = current.slice();
    const order = ORDER[topic];
    let sorted = true;
    for (const row of payloads) {
      const key = rowKey(topic, row);
      if (!key) continue;
      const at = index.get(key);
      if (at !== undefined) {
        merged[at] = row;
        continue;
      }
      if (order && merged.length && order(merged[merged.length - 1], row) > 0) sorted = false;
      index.set(key, merged.length);
      merged.push(row);
    }
    if (order && !sorted) {
      merged.sort(order);
      index.clear();
      merged.forEach((row, i) => index.set(rowKey(topic, row) ?? `#${i}`, i));
    }
    positions.set(merged, index);
    (next as Record<string, unknown>)[field] = merged;
  }
  if (groups.has("race_control") || session) next.raceControl = ownRaceControl(next.raceControl, next.session);
  if (groups.has("laps") || groups.has("race_control") || session) next.span = runningSpan(next.kind, next.laps, next.raceControl, next.session);
  return next;
}
