/**
 * OpenF1 real-time topics ("v1/<endpoint>", https://openf1.org/auth.html). Messages are REST rows
 * plus `_id` (unique, ever increasing) and `_key` (same record, newer version). Rows are stored by
 * their natural identity instead of `_key`, so rows fetched over REST to fill a gap (which have no
 * `_key`) land on the same records.
 */
export const ROW_TOPICS = ["sessions", "drivers", "laps", "position", "intervals", "race_control", "pit", "stints", "weather", "session_result", "starting_grid"] as const;
export const TELEMETRY_TOPICS = ["location", "car_data"] as const;
export type RowTopic = (typeof ROW_TOPICS)[number];
export type TelemetryTopic = (typeof TELEMETRY_TOPICS)[number];

export const topicOf = (mqttTopic: string): string => mqttTopic.replace(/^v1\//, "");
export const isRowTopic = (topic: string): topic is RowTopic => (ROW_TOPICS as readonly string[]).includes(topic);
export const isTelemetryTopic = (topic: string): topic is TelemetryTopic => (TELEMETRY_TOPICS as readonly string[]).includes(topic);

type Row = Record<string, unknown>;
const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));

/** The record a row belongs to, or null if it lacks the fields that identify it. */
export function rowKey(topic: RowTopic, row: Row): string | null {
  const need = (...fields: string[]) => (fields.every((f) => row[f] !== null && row[f] !== undefined) ? fields.map((f) => v(row[f])).join("|") : null);
  switch (topic) {
    case "sessions":
      return need("session_key");
    case "drivers":
    case "session_result":
    case "starting_grid":
      return need("driver_number");
    case "laps":
      return need("driver_number", "lap_number");
    case "position":
    case "intervals":
      return need("driver_number", "date");
    case "pit":
      return need("driver_number", "date");
    case "stints":
      return need("driver_number", "stint_number");
    case "weather":
      return need("date");
    case "race_control":
      // No id in the feed; a message is its time, category, driver and text.
      return row.date ? [v(row.date), v(row.category), v(row.driver_number), v(row.message)].join("|") : null;
  }
}

/** A row without the feed's own bookkeeping fields. */
export function stripFeedFields<T extends Row>(row: T): Omit<T, "_id" | "_key"> {
  const { _id: _ignoredId, _key: _ignoredKey, ...rest } = row;
  void _ignoredId;
  void _ignoredKey;
  return rest;
}

/** One write per record: the highest msg_id, else the last one given. */
export function newestPerRecord<T extends { topic: string; key: string; msg_id: number | null }>(rows: T[]): T[] {
  const out = new Map<string, T>();
  for (const r of rows) {
    const id = `${r.topic}|${r.key}`;
    const prev = out.get(id);
    if (!prev || r.msg_id === null || prev.msg_id === null || r.msg_id >= prev.msg_id) out.set(id, r);
  }
  return [...out.values()];
}
