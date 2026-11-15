/**
 * A stand-in for OpenF1's paid tier, for building and testing live mode without an account.
 * Replays a stored session in real time, shifted so it happens now:
 *
 *   POST /token                      form username/password -> {"access_token", "expires_in": "3600"}
 *   GET  /v1/<endpoint>?...          REST, bearer token required, only rows dated up to "now"
 *   ws://localhost:<port>/mqtt       MQTT over WebSocket, the token as password; topics v1/<endpoint>,
 *                                    messages are REST rows plus `_id` (increasing) and `_key`
 *
 *   npm run fake-openf1 -- [--session 11369] [--port 4100] [--lap 10]   (start just before that lap)
 *                          [--at 2026-09-13T13:26:35Z]   (start at this session time)
 *                          [--fixtures]                  (recorded fixtures: short telemetry windows, no network)
 *
 * Credentials it accepts: FAKE_OPENF1_USERNAME / FAKE_OPENF1_PASSWORD (default "fake" / "fake").
 * Reads the session from the app's store (Supabase per .env.local, or .cache/store).
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import nextEnv from "@next/env";
import { Aedes } from "aedes";
import { createWebSocketStream, WebSocketServer } from "ws";

nextEnv.loadEnvConfig(process.cwd());
const { readJson } = await import("@/lib/storage/store");
const { metaKey, chunkKey } = await import("@/lib/session/ingest");
const { decodeChunk } = await import("@/lib/session/telemetry");
type SessionMeta = import("@/lib/session/types").SessionMeta;
type TelemetryChunk = import("@/lib/session/types").TelemetryChunk;

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const SESSION = Number(arg("session", "11369"));
const AT = arg("at", "");
const FIXTURES = process.argv.includes("--fixtures");
const PORT = Number(arg("port", "4100"));
const LAP = Number(arg("lap", "0"));
const USER = process.env.FAKE_OPENF1_USERNAME ?? "fake";
const PASS = process.env.FAKE_OPENF1_PASSWORD ?? "fake";

const { fixtureChunk, fixtureMeta } = await import("@/lib/session/fixtures");
const meta = FIXTURES ? await fixtureMeta(SESSION, { multiviewer: null, learned: null }) : await readJson<SessionMeta>(metaKey(SESSION));
if (!meta) throw new Error(`Session ${SESSION} is not in the ${FIXTURES ? "fixtures" : "store"}`);
const chunks: TelemetryChunk[] = [];
for (const w of meta.windows) {
  const c = FIXTURES ? await fixtureChunk(SESSION, w.index) : await readJson<TelemetryChunk>(chunkKey(SESSION, w.index));
  if (c) chunks.push(c);
}

// "Now" in session time when the fake starts: a little before the chosen lap, or 2 minutes before the span.
const lapStart = LAP > 0 ? Math.min(...meta.laps.filter((l) => l.lap_number === LAP && l.date_start).map((l) => Date.parse(l.date_start!))) : NaN;
const sessionAtStart = AT ? Date.parse(AT) : Number.isFinite(lapStart) ? lapStart - 30_000 : meta.span.start - 120_000;
const SHIFT = Date.now() - sessionAtStart; // add to a session time to get the wall-clock time it is replayed at
const shift = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + SHIFT).toISOString() : iso ?? null);
const sessionNow = () => Date.now() - SHIFT;

// ---- The session's rows, shifted to now ---------------------------------------------------------
type Row = Record<string, unknown>;
const datedShift = (rows: Row[]) => rows.map((r) => ({ ...r, ...(typeof r.date === "string" ? { date: shift(r.date) } : {}) }));
const session = { ...meta.session, date_start: shift(meta.session.date_start)!, date_end: shift(meta.session.date_end)! };
const meeting = { ...meta.meeting, date_start: shift(meta.meeting.date_start)!, ...(meta.meeting.date_end ? { date_end: shift(meta.meeting.date_end) } : {}) };
const laps = meta.laps.map((l) => ({ ...l, date_start: shift(l.date_start) }));
const tables: Record<string, Row[]> = {
  sessions: [session],
  meetings: [meeting],
  drivers: meta.drivers as unknown as Row[],
  laps: laps as unknown as Row[],
  position: datedShift(meta.positions as unknown as Row[]),
  intervals: datedShift(meta.intervals as unknown as Row[]),
  race_control: datedShift(meta.raceControl as unknown as Row[]),
  pit: datedShift(meta.pits as unknown as Row[]),
  stints: (meta.stints ?? []) as unknown as Row[],
  session_result: meta.results as unknown as Row[],
};
const lapEndMs = (l: (typeof laps)[number]) => (l.date_start && l.lap_duration !== null ? Date.parse(l.date_start) + l.lap_duration * 1000 : null);

/** A lap as the feed shows it at wall time `now`: sectors appear as they are completed. */
function lapAt(l: (typeof laps)[number], now: number): Row | null {
  if (!l.date_start || Date.parse(l.date_start) > now) return null;
  const start = Date.parse(l.date_start);
  const s1 = l.duration_sector_1 !== null ? start + l.duration_sector_1 * 1000 : null;
  const s2 = s1 !== null && l.duration_sector_2 !== null ? s1 + l.duration_sector_2 * 1000 : null;
  const end = lapEndMs(l);
  return {
    ...l,
    duration_sector_1: s1 !== null && s1 <= now ? l.duration_sector_1 : null,
    duration_sector_2: s2 !== null && s2 <= now ? l.duration_sector_2 : null,
    duration_sector_3: end !== null && end <= now ? l.duration_sector_3 : null,
    lap_duration: end !== null && end <= now ? l.lap_duration : null,
  };
}

/** Rows of a table visible at wall time `now`. Rows without a date are visible from the start. */
function visible(endpoint: string, now: number): Row[] {
  if (endpoint === "laps") return laps.map((l) => lapAt(l, now)).filter((r): r is Row => r !== null);
  if (endpoint === "stints") {
    const lapStartOf = (driver: number, lap: number | null) => laps.find((l) => l.driver_number === driver && l.lap_number === lap)?.date_start;
    return tables.stints.filter((s) => {
      const at = lapStartOf(s.driver_number as number, (s.lap_start as number | null) ?? 1);
      return !at || Date.parse(at) <= now;
    });
  }
  if (endpoint === "session_result") return Date.parse(session.date_end) <= now ? tables.session_result : [];
  return (tables[endpoint] ?? []).filter((r) => typeof r.date !== "string" || Date.parse(r.date) <= now);
}

// ---- Telemetry, decoded once into rows sorted by time -------------------------------------------
type Sample = { t: number; topic: "location" | "car_data"; row: Row };
const samples: Sample[] = [];
for (const c of chunks) {
  for (const [driver, { trace, car }] of decodeChunk(c)) {
    for (let i = 0; i < trace.t.length; i++) samples.push({ t: trace.t[i] + SHIFT, topic: "location", row: { driver_number: driver, x: trace.x[i], y: trace.y[i], z: 0 } });
    for (let i = 0; i < car.t.length; i++)
      samples.push({ t: car.t[i] + SHIFT, topic: "car_data", row: { driver_number: driver, speed: car.speed[i], throttle: car.throttle[i], brake: car.brake[i], n_gear: car.gear[i], rpm: car.rpm[i] } });
  }
}
samples.sort((a, b) => a.t - b.t);
const telemetryRest = (endpoint: string, from: number, to: number) =>
  samples.filter((s) => s.topic === endpoint && s.t >= from && s.t < to && s.t <= Date.now()).map((s) => ({ ...s.row, date: new Date(s.t).toISOString(), session_key: SESSION, meeting_key: meta.meeting.meeting_key }));

// ---- HTTP: token and REST ------------------------------------------------------------------------
const tokens = new Set<string>();
let restCalls = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "POST" && url.pathname === "/token") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (form.get("username") !== USER || form.get("password") !== PASS) return send(401, { detail: "Invalid credentials" });
    const token = randomUUID();
    tokens.add(token);
    return send(200, { expires_in: "3600", access_token: token, token_type: "bearer" });
  }
  const m = /^\/v1\/([a-z_]+)$/.exec(url.pathname);
  if (!m) return send(404, { detail: "Not found" });
  const bearer = req.headers.authorization?.replace(/^Bearer /, "");
  if (!bearer || !tokens.has(bearer)) return send(401, { detail: "Live data needs a valid token" });
  restCalls++;
  // Filters: key=value, and date with >=, <=, >, < (OpenF1's syntax, operator unencoded).
  const filters = (url.search.slice(1) ? url.search.slice(1).split("&") : []).map((part) => {
    const f = /^([a-z_]+)(>=|<=|>|<|=)(.*)$/.exec(decodeURIComponent(part));
    return f ? { field: f[1], op: f[2], value: f[3] } : null;
  }).filter((f) => f !== null);
  const endpoint = m[1];
  const now = Date.now();
  let rows: Row[];
  if (endpoint === "location" || endpoint === "car_data") {
    const from = Math.max(...filters.filter((f) => f.field === "date" && f.op.startsWith(">")).map((f) => Date.parse(f.value)), -Infinity);
    const to = Math.min(...filters.filter((f) => f.field === "date" && f.op.startsWith("<")).map((f) => Date.parse(f.value)), Infinity);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return send(422, { detail: "Give a date range for telemetry" });
    rows = telemetryRest(endpoint, from, to);
  } else {
    rows = visible(endpoint, now).map((r) => ({ session_key: SESSION, meeting_key: meta.meeting.meeting_key, ...r }));
  }
  rows = rows.filter((r) =>
    filters.every((f) => {
      const v = r[f.field];
      if (v === undefined) return true;
      if (f.op === "=") return String(v) === f.value;
      const a = f.field === "date" ? Date.parse(String(v)) : Number(v);
      const b = f.field === "date" ? Date.parse(f.value) : Number(f.value);
      return f.op === ">=" ? a >= b : f.op === "<=" ? a <= b : f.op === ">" ? a > b : a < b;
    }),
  );
  if (rows.length === 0) return send(404, { detail: "No results found." });
  send(200, rows);
});

// ---- MQTT over WebSocket -------------------------------------------------------------------------
const broker = await Aedes.createBroker();
broker.authenticate = (_client, username, password, done) => done(null, Boolean(username) && Boolean(password) && tokens.has(password!.toString()));
let connected = 0;
broker.on("client", (c) => console.log(`mqtt: ${c.id} connected (${++connected} open)`));
broker.on("clientDisconnect", (c) => console.log(`mqtt: ${c.id} disconnected (${--connected} open)`));
const wss = new WebSocketServer({ server, path: "/mqtt" });
wss.on("connection", (socket, req) => broker.handle(createWebSocketStream(socket) as never, req as never));

let nextId = Date.now() * 1000;
const publish = (topic: string, row: Row, key: string) =>
  broker.publish({ cmd: "publish", topic: `v1/${topic}`, payload: Buffer.from(JSON.stringify({ session_key: SESSION, meeting_key: meta.meeting.meeting_key, ...row, _key: key, _id: ++nextId })), qos: 0, dup: false, retain: false }, () => {});

// Low-rate events, as (time, topic, row, key); laps once per change of what is known.
type Event = { t: number; topic: string; row: Row; key: string };
const events: Event[] = [];
const atDate = (topic: string, rows: Row[], key: (r: Row) => string) => {
  for (const r of rows) if (typeof r.date === "string") events.push({ t: Date.parse(r.date), topic, row: r, key: key(r) });
};
atDate("position", tables.position, (r) => `${Date.parse(r.date as string)}_${r.driver_number}`);
atDate("intervals", tables.intervals, (r) => `${Date.parse(r.date as string)}_${r.driver_number}`);
atDate("race_control", tables.race_control, (r) => `${Date.parse(r.date as string)}_${r.category}`);
atDate("pit", tables.pit, (r) => `${Date.parse(r.date as string)}_${r.driver_number}`);
for (const l of laps) {
  if (!l.date_start) continue;
  const start = Date.parse(l.date_start);
  const times = [start];
  if (l.duration_sector_1 !== null) times.push(start + l.duration_sector_1 * 1000);
  if (l.duration_sector_1 !== null && l.duration_sector_2 !== null) times.push(start + (l.duration_sector_1 + l.duration_sector_2) * 1000);
  const end = lapEndMs(l);
  if (end !== null) times.push(end);
  for (const t of times) events.push({ t, topic: "laps", row: lapAt(l, t)!, key: `${l.driver_number}_${l.lap_number}` });
}
for (const s of tables.stints) {
  const at = laps.find((l) => l.driver_number === s.driver_number && l.lap_number === ((s.lap_start as number | null) ?? 1))?.date_start;
  events.push({ t: at ? Date.parse(at) : Date.parse(session.date_start), topic: "stints", row: s, key: `${s.driver_number}_${s.stint_number}` });
}
events.push({ t: Date.parse(session.date_end) + 60_000, topic: "session_result", row: {}, key: "results" });
events.sort((a, b) => a.t - b.t);

let ei = events.findIndex((e) => e.t > Date.now());
if (ei < 0) ei = events.length;
let si = samples.findIndex((s) => s.t > Date.now());
if (si < 0) si = samples.length;
let published = 0;
setInterval(() => {
  const now = Date.now();
  for (; si < samples.length && samples[si].t <= now; si++, published++) {
    const s = samples[si];
    publish(s.topic, { ...s.row, date: new Date(s.t).toISOString() }, `${s.t}_${s.row.driver_number}`);
  }
  for (; ei < events.length && events[ei].t <= now; ei++, published++) {
    const e = events[ei];
    if (e.topic === "session_result") for (const r of tables.session_result) publish("session_result", r, `${r.driver_number}`);
    else publish(e.topic, e.row, e.key);
  }
}, 50);

setInterval(() => {
  const lap = meta.laps.filter((l) => l.date_start && Date.parse(l.date_start) <= sessionNow()).reduce((m, l) => Math.max(m, l.lap_number), 0);
  console.log(`replaying ${meta.meeting.meeting_name} ${meta.session.session_name} at ${new Date(sessionNow()).toISOString().slice(11, 19)} (lap ${lap}); ${published} messages, ${restCalls} REST calls, ${connected} MQTT clients`);
}, 30_000);

server.listen(PORT, () => {
  console.log(`fake OpenF1 on http://localhost:${PORT}: replaying ${SESSION} (${meta.meeting.meeting_name} ${meta.session.session_name}) from ${new Date(sessionAtStart).toISOString().slice(11, 19)} session time`);
  console.log(`  OPENF1_API_BASE=http://localhost:${PORT}/v1 OPENF1_MQTT_URL=ws://localhost:${PORT}/mqtt OPENF1_USERNAME=${USER} OPENF1_PASSWORD=<${USER === "fake" ? "fake" : "set"}>`);
  console.log(`  shifted session: ${session.date_start} to ${session.date_end}`);
});
