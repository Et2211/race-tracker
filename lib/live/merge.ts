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

const byDate = <T extends { date: string }>(rows: T[]) => [...rows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

/**
 * Folds rows from the live feed into a session: a row replaces the one with the same identity
 * (a lap gaining its sector times, say), others are added. Returns a new object, so React sees
 * the change. The session's own row (`sessions`) updates its schedule.
 */
export function mergeLiveRows(meta: SessionMeta, rows: LiveRow[]): SessionMeta {
  if (rows.length === 0) return meta;
  const next: SessionMeta = { ...meta };
  const groups = new Map<RowTopic, Record<string, unknown>[]>();
  for (const r of rows) {
    if (!isRowTopic(r.topic)) continue;
    const list = groups.get(r.topic) ?? [];
    list.push(r.payload);
    groups.set(r.topic, list);
  }
  const session = groups.get("sessions")?.find((s) => s.session_key === meta.session.session_key);
  if (session) next.session = { ...meta.session, ...(session as Partial<Session>) };
  for (const [topic, payloads] of groups) {
    if (!(topic in FIELD)) continue;
    const field = FIELD[topic as keyof typeof FIELD] as Field;
    const current = ((next[field] as unknown as Record<string, unknown>[] | undefined) ?? []);
    const byKey = new Map<string, Record<string, unknown>>();
    for (const row of current) byKey.set(rowKey(topic, row) ?? `#${byKey.size}`, row);
    for (const row of payloads) {
      const key = rowKey(topic, row);
      if (key) byKey.set(key, row);
    }
    (next as Record<string, unknown>)[field] = [...byKey.values()];
  }
  next.raceControl = ownRaceControl(next.raceControl, next.session);
  next.positions = byDate(next.positions);
  next.intervals = byDate(next.intervals);
  next.laps = [...next.laps].sort((a, b) => a.lap_number - b.lap_number || a.driver_number - b.driver_number);
  next.span = runningSpan(next.kind, next.laps, next.raceControl, next.session);
  return next;
}
