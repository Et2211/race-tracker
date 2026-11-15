import { flagStateAt } from "@/lib/flags/state";
import type { SessionResult } from "@/lib/openf1/types";
import { fitOutline, MAP_HEIGHT, MAP_WIDTH, toMap, toPath } from "@/lib/track/map";
import type { SessionMeta } from "./types";

/**
 * A few kilobytes about a stored session, for the homepage: the classification, the drivers with
 * their team colours, the fastest lap and how eventful it was. Written next to the session's
 * metadata when it is downloaded, so the homepage never has to read a 5 MB metadata file.
 */
export type SessionSummary = {
  version: 1;
  sessionKey: number;
  year: number;
  meetingKey: number;
  meetingName: string;
  circuit: string;
  circuitKey: number;
  sessionName: string;
  kind: SessionMeta["kind"];
  dateStart: string;
  drivers: { number: number; code: string; name: string; team: string; colour: string }[];
  /** Official classification, in order; `gap` as OpenF1 gives it ("+1 LAP", seconds, or null for the winner). */
  classification: { driver: number; position: number | null; gap: string | null; status: string | null }[];
  laps: number | null;
  fastestLap: { driver: number; lap: number; seconds: number } | null;
  /** Incidents rather than messages: a yellow and its warning sector raised together count once. */
  incidents: { yellow: number; doubleYellow: number; safetyCar: number; vsc: number; red: number };
};

/** A circuit outline for small drawings, in the same 600 × 410 box as the track map. */
export type CircuitShape = { circuitKey: number; name: string; year: number; path: string; startX: number; startY: number };

const resultStatus = (r: SessionResult) => (r.dsq ? "DSQ" : r.dns ? "DNS" : r.dnf ? "DNF" : null);

function gapText(gap: SessionResult["gap_to_leader"]): string | null {
  // Qualifying results carry one gap per phase; the last one given is the deciding phase.
  const value = Array.isArray(gap) ? [...gap].reverse().find((g) => g !== null && g !== undefined) ?? null : gap;
  if (value === null || value === undefined || value === 0) return null;
  return typeof value === "number" ? `+${value.toFixed(3)}` : String(value);
}

function countIncidents(meta: SessionMeta): SessionSummary["incidents"] {
  const counts = { yellow: 0, doubleYellow: 0, safetyCar: 0, vsc: 0, red: 0 };
  const seen = new Set<number>();
  for (const row of meta.raceControl) {
    if (row.category === "SafetyCar" && row.message.startsWith("SAFETY CAR DEPLOYED")) counts.safetyCar++;
    else if (row.category === "SafetyCar" && row.message.startsWith("VSC DEPLOYED")) counts.vsc++;
    else if (row.flag === "RED") counts.red++;
    else if (row.scope === "Sector" && (row.flag === "YELLOW" || row.flag === "DOUBLE YELLOW")) {
      for (const g of flagStateAt(meta.raceControl, Date.parse(row.date)).groups) {
        if (seen.has(g.since)) continue;
        seen.add(g.since);
        if (g.flag === "DOUBLE YELLOW") counts.doubleYellow++;
        else counts.yellow++;
      }
    }
  }
  return counts;
}

export function summarize(meta: SessionMeta): SessionSummary {
  const ordered = [...meta.results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  let fastest: SessionSummary["fastestLap"] = null;
  for (const lap of meta.laps) {
    if (lap.lap_duration === null || lap.is_pit_out_lap) continue;
    if (!fastest || lap.lap_duration < fastest.seconds) fastest = { driver: lap.driver_number, lap: lap.lap_number, seconds: lap.lap_duration };
  }
  return {
    version: 1,
    sessionKey: meta.session.session_key,
    year: meta.session.year,
    meetingKey: meta.meeting.meeting_key,
    meetingName: meta.meeting.meeting_name,
    circuit: meta.session.circuit_short_name,
    circuitKey: meta.session.circuit_key,
    sessionName: meta.session.session_name,
    kind: meta.kind,
    dateStart: meta.session.date_start,
    drivers: meta.drivers.map((d) => ({
      number: d.driver_number,
      code: d.name_acronym,
      name: d.last_name ?? d.full_name,
      team: d.team_name ?? "",
      colour: d.team_colour ? `#${d.team_colour}` : "#9AA3B2",
    })),
    classification: ordered.map((r) => ({ driver: r.driver_number, position: r.position, gap: gapText(r.gap_to_leader), status: resultStatus(r) })),
    laps: meta.kind === "race" && meta.laps.length ? Math.max(...meta.laps.map((l) => l.lap_number)) : null,
    // In a race the fastest lap is a curiosity; in qualifying the classification already says it.
    fastestLap: meta.kind === "race" ? fastest : null,
    incidents: countIncidents(meta),
  };
}

/** The outline as a simplified SVG path, or null when the session has none. */
export function circuitShape(meta: SessionMeta): CircuitShape | null {
  if (!meta.outline) return null;
  const transform = fitOutline(meta.outline, meta.rotation);
  // Every third point is plenty for a drawing a few hundred pixels wide.
  const points = meta.outline.points.filter((_, i, all) => i % 3 === 0 || i === all.length - 1).map((p) => toMap(transform, p));
  const start = toMap(transform, meta.outline.points[0]);
  return { circuitKey: meta.session.circuit_key, name: meta.session.circuit_short_name, year: meta.session.year, path: `${toPath(points)} Z`, startX: start.x, startY: start.y };
}

export const SHAPE_VIEWBOX = `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`;
