import { battlesAt } from "@/lib/timing/battles";
import { flagStateAt, logAt, logTone, STALE_AFTER_MS, type FlagGroup } from "@/lib/flags/state";
import { isRetiredAt, retirements } from "@/lib/incident/retired";
import { incidentsNear, namedIncidents, type NamedIncident } from "@/lib/incident/messages";
import { DETECTOR, findStoppedCars } from "@/lib/incident/stopped";
import { flaggedStretch, splitByStretch } from "@/lib/incident/stretch";
import type { Driver, Lap, RaceControl } from "@/lib/openf1/types";
import { traceAt, type TelemetryIndex } from "@/lib/session/telemetry";
import type { SessionMeta } from "@/lib/session/types";
import { formatClock } from "@/lib/timing/format";
import { buildQualifying } from "@/lib/timing/qualifying";
import { buildRaceTable, classificationDifferences, gapTrend, leaderLap } from "@/lib/timing/race";
import { placeMarshalSector } from "@/lib/track/markers";
import { fitOutline, mapPointAt, MAP_HEIGHT, MAP_WIDTH, stretchPath, toMap, type MapTransform } from "@/lib/track/map";
import type { CarDot, DriverInfo, FlagView, QualifyingView, Snapshot, TrackMapModel } from "./model";

export function driverInfo(drivers: Driver[]): Record<number, DriverInfo> {
  return Object.fromEntries(
    drivers.map((d) => [
      d.driver_number,
      {
        number: d.driver_number,
        code: d.name_acronym,
        name: d.last_name ?? d.full_name,
        team: d.team_name ?? "",
        // A missing colour is shown as neutral grey rather than guessed.
        colour: d.team_colour ? `#${d.team_colour}` : "#9AA3B2",
      },
    ]),
  );
}

export type StaticView = { drivers: Record<number, DriverInfo>; map: TrackMapModel | null; transform: MapTransform | null; totalLaps: number | null };

/** The parts of the view that do not change with time. */
export function buildStatic(meta: SessionMeta): StaticView {
  const drivers = driverInfo(meta.drivers);
  const totalLaps = meta.kind === "race" && meta.laps.length ? Math.max(...meta.laps.map((l) => l.lap_number)) : null;
  const outline = meta.outline;
  if (!outline) return { drivers, map: null, transform: null, totalLaps };
  const transform = fitOutline(outline, meta.rotation);
  const bounds = [0, outline.s1, outline.s2, outline.length];
  const sectorPaths = [0, 1, 2].map((i) => stretchPath(outline, transform, bounds[i], bounds[i + 1])) as TrackMapModel["sectorPaths"];
  const ticks = [0, outline.s1, outline.s2].map((s, i) => {
    const p = mapPointAt(outline, transform, s);
    return { x1: p.x - p.nx * 12, y1: p.y - p.ny * 12, x2: p.x + p.nx * 12, y2: p.y + p.ny * 12, start: i === 0 };
  });
  const labels: TrackMapModel["labels"] = [0, 1, 2].map((i) => {
    const p = mapPointAt(outline, transform, (bounds[i] + bounds[i + 1]) / 2);
    return { x: p.x + p.nx * 26, y: p.y + p.ny * 26 + 6, text: `S${i + 1}`, sector: (i + 1) as 1 | 2 | 3 };
  });
  const start = mapPointAt(outline, transform, 0);
  labels.push({ x: start.x + start.nx * 30, y: start.y + start.ny * 30 + 4, text: "START / FINISH", sector: 0 });
  return { drivers, map: { width: MAP_WIDTH, height: MAP_HEIGHT, sectorPaths, ticks, labels }, transform, totalLaps };
}

const lapEnd = (lap: Lap) => (lap.date_start && lap.lap_duration !== null ? Date.parse(lap.date_start) + lap.lap_duration * 1000 : Infinity);

function runningStart(meta: SessionMeta): number {
  const started = meta.raceControl.find((r) => r.message === "SESSION STARTED");
  return started ? Date.parse(started.date) : meta.span.start;
}

function flagView(meta: SessionMeta, view: StaticView, telemetry: TelemetryIndex, group: FlagGroup, now: number, incidents: NamedIncident[]): FlagView {
  const outline = meta.outline;
  const transform = view.transform;
  let placement: FlagView["placement"] = { known: false, reason: "There is no track outline for this session." };
  if (outline && transform) {
    const p = placeMarshalSector(meta.marshal, outline, group.sector);
    if (p.kind === "stretch") {
      const mid = p.from <= p.to ? (p.from + p.to) / 2 : ((p.from + p.to + outline.length) / 2) % outline.length;
      const flag = mapPointAt(outline, transform, mid);
      placement = { known: true, path: stretchPath(outline, transform, p.from, p.to), flagX: flag.x + flag.nx * 34, flagY: flag.y + flag.ny * 34, basis: p.basis };
    } else {
      placement = { known: false, reason: p.reason };
    }
  }

  const staleMs = now - group.since;
  const base = {
    flag: group.flag,
    sector: group.sector,
    alsoSectors: group.sectors.filter((s) => s !== group.sector),
    raisedAt: formatClock(group.since),
    // Flags before lights out are stamped lap 1 by OpenF1; they are not part of lap 1.
    lap: meta.kind === "race" && group.since >= runningStart(meta) ? group.lap : null,
    staleMinutes: staleMs >= STALE_AFTER_MS ? Math.floor(staleMs / 60_000) : null,
    placement,
  };

  // The detector looks back a minute; if less than that is loaded, use what there is and say so.
  const range = telemetry.ranges().find(([from, to]) => group.since >= from && group.since < to);
  const wantFrom = Math.max(group.since - 60_000, meta.span.start);
  const lookBackNote = range && range[0] > wantFrom ? ` Car data starts ${Math.round((group.since - range[0]) / 1000)} s before the flag, so earlier stops are not checked.` : "";
  if (!outline || !range) {
    return { ...base, stopped: [], confidence: "none", inferred: false, confidenceNote: outline ? "Car data around this flag is not loaded yet." : "There is no track outline for this session, so stopped cars cannot be looked for." };
  }
  const state = flagStateAt(meta.raceControl, group.since);
  const chequered = meta.raceControl.find((r) => r.flag === "CHEQUERED" && meta.kind === "race");
  if (state.red || (chequered && group.since > Date.parse(chequered.date))) {
    return {
      ...base,
      stopped: [],
      confidence: "none",
      inferred: false,
      confidenceNote: state.red ? "The session is stopped; every car stops in the pit lane, so stopped cars are not looked for." : "The race has finished; cars stop after the flag, so stopped cars are not looked for.",
    };
  }
  if (!telemetry.hasPositionsNear(group.since)) {
    return { ...base, stopped: [], confidence: "none", inferred: false, confidenceNote: "OpenF1 has no car positions around this flag, so stopped cars cannot be looked for." };
  }

  const inference = findStoppedCars({
    flagAt: group.since,
    now,
    notBefore: Math.max(runningStart(meta) + 20_000, range[0]),
    outline,
    cars: telemetry.cars,
    traces: telemetry.traces,
    pits: meta.pits,
  });
  // Race control usually names the cars a few minutes later; only messages posted by `now` count.
  const named = incidentsNear(incidents.filter((i) => i.postedAt <= now), group.since);
  const namedDriver = (d: number) => named.find((i) => i.drivers.includes(d));
  // With known sector limits, a car that stopped elsewhere on the lap is listed apart and does not
  // count towards the confidence.
  const span = flaggedStretch(meta, group.sector, group.sectors);
  const { here, elsewhere } = splitByStretch(meta, span, inference.cars);
  const inside = (arc: number) => here.some((c) => c.arc === arc);
  const stopped: FlagView["stopped"] = [...here, ...elsewhere].map((car, i) => {
    const before = Math.round(car.secondsBeforeFlag);
    const timing = before > 0 ? `${before} s before the flag` : before < 0 ? `${-before} s after the flag` : "as the flag was shown";
    const at = mapPointAt(outline, transform!, car.arc);
    const message = namedDriver(car.driver);
    const away = !inside(car.arc);
    return {
      driver: car.driver,
      role: away ? "elsewhere" : i === 0 ? "first" : "stopped",
      x: at.x,
      y: at.y,
      evidence: [
        `Below ${DETECTOR.stopSpeed} km/h from ${formatClock(car.stoppedAt)}, ${timing}`,
        car.resumedAt === null
          ? `Still stopped after ${Math.round(car.stationaryFor)} s, ${Math.round(car.arc / 10)} m into the lap`
          : `Moving again at ${formatClock(car.resumedAt)} after ${Math.round(car.stationaryFor)} s, ${Math.round(car.arc / 10)} m into the lap`,
        ...(message ? [`Race control: ${message.message}`] : []),
      ],
    };
  });
  for (const c of inference.contacts) {
    stopped.push({
      driver: c.driver,
      role: "contact",
      x: null,
      y: null,
      evidence: [
        `Within ${Math.round(c.distance / 10)} m of #${c.withDriver} at ${formatClock(c.at)}`,
        `Speed fell ${Math.round(c.speedDrop)} km/h in under a second${c.resumedAt ? `, back up to speed at ${formatClock(c.resumedAt)}` : ""}`,
      ],
    });
  }
  for (const incident of named) {
    for (const d of incident.drivers) {
      if (stopped.some((s) => s.driver === d)) continue;
      stopped.push({ driver: d, role: "named", x: null, y: null, evidence: [`Race control: ${incident.message}`, "Not seen stopping on the racing line"] });
    }
  }
  const confirmed = here.some((c) => namedDriver(c.driver));
  const confidence = confirmed ? "high" : here.length ? "medium" : "none";
  return {
    ...base,
    stopped,
    confidence,
    inferred: true,
    confidenceNote:
      (here.length === 0
        ? elsewhere.length
          ? "No car stopped in the flagged stretch; the cars listed stopped elsewhere on the lap around the same time."
          : named.length
          ? "No car stopped on the racing line before the flag; race control has named cars in an incident at that time."
          : "No car stopped on the racing line in the minute before the flag. It may be debris, marshals on track or a car off the racing line."
        : confirmed
          ? "A car that stopped around the flag was named by race control in an incident at the same time."
          : `${here.length === 1 ? "One car" : `${here.length} cars`} stopped on the racing line ${span ? "in the flagged stretch " : ""}around the flag.${inference.contacts.length ? " Contact is inferred from proximity and speed." : ""}`) + lookBackNote,
  };
}

function qualifyingView(meta: SessionMeta, t: number): QualifyingView | null {
  if (meta.kind === "qualifying") {
    const laps = meta.laps.filter((l) => lapEnd(l) <= t);
    const rc = meta.raceControl.filter((r) => Date.parse(r.date) <= t);
    const { phases, ideal } = buildQualifying(laps, rc);
    return { sessionName: meta.session.session_name, phases, ideal, current: phases.at(-1)?.phase ?? null, final: false };
  }
  if (meta.qualifying) {
    const { phases, ideal } = buildQualifying(meta.qualifying.laps, meta.qualifying.raceControl);
    return { sessionName: meta.qualifying.sessionName, phases, ideal, current: null, final: true };
  }
  return null;
}

/** A stable key for a race-control row; the feed occasionally repeats a message at the same moment. */
const logIds = new WeakMap<RaceControl, string>();
let nextLogId = 0;
function logId(row: RaceControl): string {
  let id = logIds.get(row);
  if (!id) {
    id = `rc${nextLogId++}`;
    logIds.set(row, id);
  }
  return id;
}

export function buildSnapshot(meta: SessionMeta, view: StaticView, telemetry: TelemetryIndex, t: number): Snapshot {
  const state = flagStateAt(meta.raceControl, t);
  const incidents = namedIncidents(meta.raceControl, meta.meeting.gmt_offset ?? meta.session.gmt_offset ?? "00:00:00");
  const lap = leaderLap(meta.laps, t);
  const isRace = meta.kind === "race";
  const finish = meta.raceControl.find((r) => r.flag === "CHEQUERED");
  const finished = isRace && finish !== undefined && t >= Date.parse(finish.date);
  // Gaps go stale after 15 s while racing; after the flag the last gaps are the final ones.
  const race = isRace ? buildRaceTable(meta.laps, meta.positions, meta.intervals, t, finished ? Infinity : undefined) : null;

  const cars: CarDot[] = [];
  // Cars that retired from a race leave the map once they have stopped for good.
  const finalLaps = isRace ? retirements(meta.results, meta.laps) : new Map<number, number>();
  const retired: number[] = [];
  for (const [driver, finalLap] of finalLaps) {
    const trace = telemetry.traces.get(driver);
    if (finalLap === -Infinity || (trace && isRetiredAt(trace, finalLap, t))) retired.push(driver);
  }
  if (view.transform) {
    for (const [driver, trace] of telemetry.traces) {
      if (retired.includes(driver)) continue;
      const p = traceAt(trace, t);
      if (p) cars.push({ driver, ...toMap(view.transform, p) });
    }
  }

  let trend: Snapshot["trend"] = null;
  if (race) {
    const fromLap = Math.max(1, lap - 10);
    const toLap = Math.max(fromLap, lap - 1);
    const chase = race.filter((r) => r.position >= 2 && r.position <= 4).map((r) => r.driver);
    trend = { fromLap, toLap, series: gapTrend(meta.laps, chase, fromLap, toLap) };
  }

  const start = runningStart(meta);
  let watch: Snapshot["watch"] = null;
  if (race && t >= start && !finished) {
    const note = state.red
      ? "Red flag: the race is stopped."
      : state.safetyCar
        ? `${state.safetyCar.kind === "VSC" ? "Virtual safety car" : "Safety car"}: gaps are frozen or bunched up until the restart.`
        : null;
    watch = { battles: note ? [] : battlesAt(meta.laps, race.map((r) => r.driver), t, { stints: meta.stints ?? null }), note };
  }
  return {
    t,
    time: formatClock(t),
    lap,
    beforeStart: isRace && t < start,
    totalLaps: view.totalLaps,
    flags: [...state.groups].sort((a, b) => b.since - a.since).map((g) => flagView(meta, view, telemetry, g, t, incidents)),
    safetyCar: state.safetyCar ? { kind: state.safetyCar.kind, ending: state.safetyCar.ending } : null,
    red: state.red,
    cars,
    retired,
    telemetryLoaded: telemetry.covers(t),
    positionsAvailable: telemetry.covers(t) && telemetry.hasPositionsNear(t),
    race,
    hasGaps: race?.some((r) => r.gap !== null) ?? false,
    classification: finished && race && meta.results.length ? classificationDifferences(race, meta.results) : null,
    leader: race?.[0]?.driver ?? null,
    trend,
    watch,
    qualifying: qualifyingView(meta, t),
    // Every message so far, newest first; the panel scrolls.
    log: logAt(meta.raceControl, t, Infinity).map((row) => ({
      id: logId(row),
      lap: isRace && Date.parse(row.date) >= start ? row.lap_number : null,
      pre: isRace && Date.parse(row.date) < start,
      time: formatClock(Date.parse(row.date)),
      iso: new Date(Date.parse(row.date)).toISOString(),
      text: row.message,
      tone: logTone(row),
    })),
  };
}
