/**
 * Backtest of the stopped-car inference (M6). Reads sessions already ingested into the local store
 * (.cache/store, written by the app or `npm run ingest`) and compares what the detector says at
 * each yellow flag with what race control and the results say afterwards.
 *
 *   npm run backtest                 # default thresholds, writes docs/m6-backtest.md
 *   npm run backtest -- --sweep      # also tries other thresholds
 *   npm run backtest -- --learn      # also records marshal-sector positions for circuits
 *                                    # without MultiViewer data in data/marshal-sectors/
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { flagStateAt, type FlagGroup } from "@/lib/flags/state";
import { incidentsNear, namedIncidents } from "@/lib/incident/messages";
import { DETECTOR, findStoppedCars } from "@/lib/incident/stopped";
import { flaggedStretch, splitByStretch } from "@/lib/incident/stretch";
import { marshalSectors } from "@/lib/session/assemble";
import { TelemetryIndex } from "@/lib/session/telemetry";
import type { SessionMeta, TelemetryChunk } from "@/lib/session/types";

const STORE = process.env.STORE_DIR ?? path.join(process.cwd(), ".cache", "store");
const read = <T>(key: string): T | null => {
  try {
    return JSON.parse(gunzipSync(readFileSync(path.join(STORE, `${key}.gz`))).toString("utf8")) as T;
  } catch {
    return null;
  }
};

type Outcome = "right" | "wrong" | "unconfirmed" | "missed" | "empty";
type Case = {
  session: string;
  kind: string;
  at: string;
  flag: string;
  sector: number;
  detected: number[];
  contacts: number[];
  /** Stopped on track around the flag but outside the flagged stretch (not shown as involved). */
  elsewhere: number[];
  named: number[];
  outcome: Outcome;
  /** Detected stop inside the flagged sector (or its warning sector), by MultiViewer markers. */
  inSector: boolean | null;
  condition: string;
  circuitKey: number;
  sessionKey: number;
  /** Where the first detected car stopped, decimetres from the line, and how long before the flag. */
  arc: number | null;
  stopToFlagS: number | null;
  stoppedAt: string | null;
  multiviewer: boolean;
};

function load() {
  const sessions: { meta: SessionMeta; telemetry: TelemetryIndex }[] = [];
  for (const key of readdirSync(path.join(STORE, "sessions"))) {
    const meta = read<SessionMeta>(`sessions/${key}/meta.json`);
    if (!meta || !meta.outline) continue;
    if (meta.marshal.source !== "multiviewer") {
      // Learned positions, leaving this session's own stops out (as the app does).
      try {
        const learned = JSON.parse(readFileSync(path.join(process.cwd(), "data", "marshal-sectors", `${meta.session.circuit_key}.json`), "utf8"));
        meta.marshal = marshalSectors(meta.outline, null, { count: learned.count ?? null, observations: learned.observations }, meta.session.session_key);
      } catch {}
    }
    const telemetry = new TelemetryIndex();
    let complete = true;
    for (const w of meta.windows) {
      const chunk = read<TelemetryChunk>(`sessions/${key}/chunks-${w.index}.json`) ?? read<TelemetryChunk>(`sessions/${key}/chunk-${w.index}.json`);
      if (chunk) telemetry.add(chunk);
      else complete = false;
    }
    if (complete) sessions.push({ meta, telemetry });
  }
  return sessions;
}

/** Each distinct flag incident, when it was raised. */
function flagGroups(meta: SessionMeta): FlagGroup[] {
  // Look at the flag state right after every raise; a group keeps its first raise time, so the
  // last view of each group includes the warning sector raised a second later.
  const seen = new Map<number, FlagGroup>();
  for (const row of meta.raceControl) {
    if (row.scope !== "Sector" || (row.flag !== "YELLOW" && row.flag !== "DOUBLE YELLOW")) continue;
    for (const g of flagStateAt(meta.raceControl, Date.parse(row.date)).groups) seen.set(g.since, g);
  }
  return [...seen.values()].sort((a, b) => a.since - b.since);
}

function condition(meta: SessionMeta, at: number): string {
  const s = flagStateAt(meta.raceControl, at);
  if (s.red) return "red flag";
  if (s.safetyCar) return s.safetyCar.kind;
  const started = meta.raceControl.find((r) => r.message === "SESSION STARTED");
  if (started && at < Date.parse(started.date)) return "before start";
  const finish = meta.raceControl.filter((r) => r.flag === "CHEQUERED").map((r) => Date.parse(r.date));
  if (meta.kind === "race" && finish.length && at > Math.max(...finish)) return "after finish";
  return "green";
}

function run(sessions: ReturnType<typeof load>, params: typeof DETECTOR, evalAfterMs = 60_000): Case[] {
  const cases: Case[] = [];
  for (const { meta, telemetry } of sessions) {
    const incidents = namedIncidents(meta.raceControl, meta.meeting.gmt_offset ?? "00:00:00");
    const started = meta.raceControl.find((r) => r.message === "SESSION STARTED");
    const notBefore = (started ? Date.parse(started.date) : meta.span.start) + 20_000;
    for (const g of flagGroups(meta)) {
      if (!telemetry.covers(g.since) || !telemetry.hasPositionsNear(g.since)) continue;
      const r = findStoppedCars({ flagAt: g.since, now: g.since + evalAfterMs, notBefore, outline: meta.outline!, cars: telemetry.cars, traces: telemetry.traces, pits: meta.pits, params });
      const named = [...new Set(incidentsNear(incidents, g.since).flatMap((i) => i.drivers))];
      // Score what the dashboard shows: with known sector limits, only cars stopped in the flagged stretch.
      const stretch = process.env.BACKTEST_NO_STRETCH ? null : flaggedStretch(meta, g.sector, g.sectors);
      const { here, elsewhere } = splitByStretch(meta, stretch, r.cars);
      const detected = here.map((c) => c.driver);
      const retired = here.filter((c) => c.resumedAt === null && meta.results.some((x) => x.driver_number === c.driver && x.dnf)).map((c) => c.driver);
      const truth = new Set([...named, ...retired]);
      const outcome: Outcome = detected.length
        ? detected.some((d) => truth.has(d)) ? "right" : truth.size ? "wrong" : "unconfirmed"
        : truth.size ? "missed" : "empty";
      cases.push({
        session: `${meta.session.year} ${meta.meeting.meeting_name} ${meta.session.session_name}`,
        kind: meta.kind,
        at: new Date(g.since).toISOString().slice(11, 19),
        flag: g.flag,
        sector: g.sector,
        detected,
        contacts: r.contacts.map((c) => c.driver),
        named,
        outcome,
        inSector: r.cars[0] ? (stretch ? here.includes(r.cars[0]) : null) : null,
        elsewhere: elsewhere.map((c) => c.driver),
        condition: condition(meta, g.since),
        circuitKey: meta.session.circuit_key,
        sessionKey: meta.session.session_key,
        arc: r.cars[0]?.arc ?? null,
        stopToFlagS: r.cars[0] ? r.cars[0].secondsBeforeFlag : null,
        stoppedAt: r.cars[0] ? new Date(r.cars[0].stoppedAt).toISOString() : null,
        multiviewer: meta.marshal.source === "multiviewer",
      });
    }
  }
  return cases;
}

const count = (cases: Case[], o: Outcome) => cases.filter((c) => c.outcome === o).length;
function summary(cases: Case[]) {
  const withCar = cases.filter((c) => c.detected.length);
  const located = withCar.filter((c) => c.inSector !== null);
  return {
    flags: cases.length,
    right: count(cases, "right"),
    wrong: count(cases, "wrong"),
    unconfirmed: count(cases, "unconfirmed"),
    missed: count(cases, "missed"),
    empty: count(cases, "empty"),
    inSector: `${located.filter((c) => c.inSector).length}/${located.length}`,
  };
}

const sessions = load();
const all = run(sessions, DETECTOR);
const green = all.filter((c) => c.condition === "green");
const lines: string[] = [];
const table = (rows: Record<string, unknown>[]) => {
  const keys = Object.keys(rows[0] ?? {});
  return [`| ${keys.join(" | ")} |`, `| ${keys.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${keys.map((k) => String(r[k])).join(" | ")} |`)].join("\n");
};

lines.push("# M6 backtest: stopped-car inference", "", `Generated by \`npm run backtest\` on ${new Date().toISOString().slice(0, 10)} from ${sessions.length} ingested sessions.`, "");
lines.push("Each yellow or double-yellow flag incident (a group of neighbouring sectors raised together) is evaluated one minute after it was raised, with the thresholds in `lib/incident/stopped.ts`.", "");
lines.push("Ground truth comes from data the detector does not use: race-control messages naming cars in an incident whose bracketed time is within 90 s before to 30 s after the flag, and cars that stopped for good and are classified as not finishing.", "");
lines.push("- **right**: a detected car is named by race control or retired there", "- **wrong**: race control named other cars, none detected", "- **unconfirmed**: a car was detected but nothing names it (a spin without a stewards' note is common)", "- **missed**: race control named cars but nothing was detected", "- **empty**: nothing detected and nothing named (debris, marshals, a car off line)", "- **in sector**: for circuits with MultiViewer markers, whether the first car to stop was inside the flagged stretch (cars stopped elsewhere are listed apart in the dashboard and not scored)", "");
lines.push("## Sessions", "", sessions.map((s) => `- ${s.meta.session.year} ${s.meta.meeting.meeting_name} ${s.meta.session.session_name} (${s.meta.session.session_key}, marshal sectors: ${s.meta.marshal.source})`).join("\n"), "");
lines.push("## Results", "", table([{ set: "all flags", ...summary(all) }, { set: "green-flag running only", ...summary(green) }, ...["VSC", "SC", "red flag", "before start", "after finish"].map((c) => ({ set: c, ...summary(all.filter((x) => x.condition === c)) })).filter((r) => r.flags > 0)]), "");
lines.push("## Every flag", "", table(all.map((c) => ({ session: c.session, time: c.at, flag: c.flag, sector: c.sector, during: c.condition, detected: c.detected.join(" ") || "–", elsewhere: c.elsewhere.join(" ") || "–", contact: c.contacts.join(" ") || "–", named: c.named.join(" ") || "–", outcome: c.outcome, "in sector": c.inSector === null ? "n/a" : c.inSector ? "yes" : "NO" }))), "");

if (process.argv.includes("--ablate")) {
  const variants: [string, typeof DETECTOR][] = [
    ["tuned: 30 km/h, 30 s look-back", DETECTOR],
    ["first guess: 20 km/h, 60 s", { ...DETECTOR, stopSpeed: 20, lookBackMs: 60_000 }],
    ["30 km/h, 60 s", { ...DETECTOR, lookBackMs: 60_000 }],
    ["20 km/h, 30 s", { ...DETECTOR, stopSpeed: 20 }],
  ];
  lines.push("## Variants (green-flag running)", "", table(variants.map(([name, p]) => ({ variant: name, ...summary(run(sessions, p).filter((c) => c.condition === "green")) }))), "");
}

if (process.argv.includes("--sweep")) {
  const rows: Record<string, unknown>[] = [];
  for (const stopSpeed of [10, 20, 30])
    for (const lookBackMs of [30_000, 60_000, 90_000])
      for (const afterFlagMs of [3000, 5000, 10_000]) {
        const s = summary(run(sessions, { ...DETECTOR, stopSpeed, lookBackMs, afterFlagMs }).filter((c) => c.condition === "green"));
        rows.push({ stopSpeed, lookBackS: lookBackMs / 1000, afterFlagS: afterFlagMs / 1000, ...s });
      }
  lines.push("## Threshold sweep (green-flag running)", "", table(rows), "");
}

if (process.argv.includes("--learn")) {
  // Clean observations only: green running, exactly one car, stopped within 15 s of the flag.
  const clean = all.filter((c) => c.condition === "green" && c.detected.length === 1 && c.arc !== null && Math.abs(c.stopToFlagS ?? 99) <= 15);
  // How good is this on circuits that do have markers?
  const check = clean.filter((c) => c.inSector !== null);
  lines.push("## Learned marshal-sector positions", "", `Clean observations (green running, one car, stopped within 15 s of the flag): ${clean.length}. On circuits with MultiViewer markers, ${check.filter((c) => c.inSector).length} of ${check.length} fall inside the flagged stretch.`, "");
  const dir = path.join(process.cwd(), "data", "marshal-sectors");
  for (const ck of new Set(clean.filter((c) => !c.multiviewer).map((c) => c.circuitKey))) {
    const file = path.join(dir, `${ck}.json`);
    let existing: { observations?: Record<string, { arc: number; session_key: number; date: string; driver_number: number }[]> } & Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(file, "utf8"));
    } catch {}
    const observations = existing.observations ?? {};
    for (const c of clean.filter((x) => x.circuitKey === ck)) {
      const list = (observations[c.sector] ??= []);
      // One observation per car per session: a parked car re-flagged several times is one incident.
      if (!list.some((o) => o.session_key === c.sessionKey && o.driver_number === c.detected[0])) list.push({ arc: Math.round(c.arc!), session_key: c.sessionKey, date: c.stoppedAt!, driver_number: c.detected[0] });
    }
    writeFileSync(file, JSON.stringify({ circuit_key: ck, ...existing, note: existing.note ?? "Where cars stopped on the racing line under isolated flags (decimetres from the start line). Written by `npm run backtest -- --learn`. A sector is drawn only with two observations within 100 m.", observations }, null, 2) + "\n");
    lines.push(`- circuit ${ck}: ${Object.entries(observations).map(([s, o]) => `sector ${s} × ${o.length}`).join(", ")}`);
  }
  lines.push("");
}

const out = path.join(process.cwd(), "docs", "m6-backtest.md");
writeFileSync(out, lines.join("\n"));
console.log(JSON.stringify({ sessions: sessions.length, all: summary(all), green: summary(green) }, null, 1));
console.log(`wrote ${out}`);
