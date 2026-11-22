import type { Lap, PitRow, PositionRow, RaceControl, Stint } from "@/lib/openf1/types";
import type { SessionKind } from "@/lib/session/types";
import { tyreState, type TyreState } from "@/lib/timing/battles";
import { deletedLaps, isDeleted } from "@/lib/timing/qualifying";
import type { Pass } from "./passes";

/**
 * One driver's session so far, at replay time `t`. Nothing after `t` is used: laps count once
 * finished, pit stops and messages once posted, tyres only for stints already started.
 */
export type DriverSummary = {
  /** Races: place at lights out and now. */
  grid: number | null;
  position: number | null;
  lapsDone: number;
  bestLap: { time: number; lap: number } | null;
  /** Laps whose time race control deleted (track limits and the like), so far. */
  deletedLaps: number;
  /** Best speed-trap reading so far, and where it ranks among everyone's best so far. */
  trap: { speed: number; lap: number; rank: number; of: number } | null;
  pitStops: PitStop[];
  tyre: TyreState | null;
  passes: { made: Pass[]; lost: Pass[] };
  messages: DriverMessage[];
};

export type PitStop = {
  lap: number;
  t: number;
  /** Seconds in the pit lane. */
  lane: number | null;
  /** Seconds stationary; null when OpenF1 has none (before the 2024 US GP, or not published yet live). */
  stationary: number | null;
  from: string | null;
  to: string | null;
};

export type DriverMessage = { t: number; lap: number | null; text: string; kind: "penalty" | "investigation" | "no action" | "deleted" | "other" };

const CARS = /\bCARS? ((?:\d+ \([A-Z]{3}\)(?:, | AND )?)+)/g;

/** Car numbers a race-control message names, from its text and its driver field. Blue flags are left out. */
export function carsNamed(row: RaceControl): number[] {
  if (row.flag === "BLUE") return [];
  const out = new Set<number>();
  if (row.driver_number !== null) out.add(row.driver_number);
  for (const m of row.message.matchAll(CARS)) for (const n of m[1].matchAll(/(\d+) \(/g)) out.add(Number(n[1]));
  return [...out];
}

function messageKind(text: string): DriverMessage["kind"] {
  if (/NO FURTHER (ACTION|INVESTIGATION)/.test(text)) return "no action";
  if (/PENALTY|REPRIMAND|DISQUALIFIED|BLACK AND (WHITE|ORANGE) FLAG|DRIVE THROUGH|STOP AND GO/.test(text)) return "penalty";
  if (/DELETED/.test(text)) return "deleted";
  if (/INVESTIGAT|NOTED|SUMMONED|REVIEW/.test(text)) return "investigation";
  return "other";
}

export type SummaryInput = {
  kind: SessionKind;
  laps: Lap[];
  raceControl: RaceControl[];
  positions: PositionRow[];
  pits: PitRow[];
  stints: Stint[] | null;
  /** All passes of the session (see `passes`); only those up to `t` are used. */
  passes: Pass[];
  /** Lights out (races) or session start. */
  start: number;
  live: boolean;
};

/** The lap `driver` was on at time `t` (the last one started), or null before their first. */
export function lapAt(laps: Lap[], driver: number, t: number): number | null {
  let out: number | null = null;
  for (const l of laps) if (l.driver_number === driver && l.date_start && Date.parse(l.date_start) <= t && (out === null || l.lap_number > out)) out = l.lap_number;
  return out;
}

const lapEnd = (l: Lap) => (l.date_start && l.lap_duration !== null ? Date.parse(l.date_start) + l.lap_duration * 1000 : Infinity);

function positionAt(positions: PositionRow[], driver: number, t: number): number | null {
  let out: number | null = null;
  for (const r of positions) {
    if (Date.parse(r.date) > t) break;
    if (r.driver_number === driver) out = r.position;
  }
  return out;
}

export function driverSummary(input: SummaryInput, driver: number, t: number): DriverSummary {
  const { kind, laps, raceControl, positions, pits, stints } = input;
  const race = kind === "race";
  const rc = raceControl.filter((r) => Date.parse(r.date) <= t);
  const deleted = deletedLaps(rc);
  const done = laps.filter((l) => lapEnd(l) <= t);
  const mine = done.filter((l) => l.driver_number === driver);

  let bestLap: DriverSummary["bestLap"] = null;
  let deletedCount = 0;
  for (const l of mine) {
    if (isDeleted(l, deleted)) {
      deletedCount++;
      continue;
    }
    // Lap 1 of a race starts from the grid, and pit laps are not representative, but they still count as laps; only deleted ones don't.
    if (l.lap_duration !== null && (!bestLap || l.lap_duration < bestLap.time)) bestLap = { time: l.lap_duration, lap: l.lap_number };
  }

  // Speed trap: best reading per driver so far.
  const trapBest = new Map<number, { speed: number; lap: number }>();
  for (const l of done) {
    if (l.st_speed === null || l.st_speed === undefined) continue;
    const cur = trapBest.get(l.driver_number);
    if (!cur || l.st_speed > cur.speed) trapBest.set(l.driver_number, { speed: l.st_speed, lap: l.lap_number });
  }
  const myTrap = trapBest.get(driver);
  const trap = myTrap ? { ...myTrap, rank: 1 + [...trapBest.values()].filter((v) => v.speed > myTrap.speed).length, of: trapBest.size } : null;

  const lapsDone = mine.reduce((m, l) => Math.max(m, l.lap_number), 0);
  const currentLap = lapsDone + 1;
  const myStints = stints ? stints.filter((s) => s.driver_number === driver && s.lap_start !== null && s.lap_start <= currentLap) : [];
  const compoundFor = (lap: number) => myStints.filter((s) => s.lap_start! <= lap).sort((a, b) => b.stint_number - a.stint_number)[0]?.compound ?? null;

  const pitStops: PitStop[] = pits
    .filter((p) => p.driver_number === driver && Date.parse(p.date) <= t)
    .map((p) => ({
      lap: p.lap_number,
      t: Date.parse(p.date),
      lane: p.lane_duration,
      stationary: p.stop_duration ?? null,
      from: compoundFor(p.lap_number),
      // The new set's stint starts on the next lap; it is known once that stint has started.
      to: myStints.some((s) => s.lap_start === p.lap_number + 1) ? compoundFor(p.lap_number + 1) : null,
    }));

  const passesSoFar = input.passes.filter((p) => p.t <= t);
  const messages: DriverMessage[] = rc
    .filter((r) => carsNamed(r).includes(driver))
    .map((r) => ({ t: Date.parse(r.date), lap: r.lap_number, text: r.message, kind: messageKind(r.message) }))
    .reverse();

  return {
    grid: race ? positionAt(positions, driver, input.start) : null,
    position: positionAt(positions, driver, t),
    lapsDone,
    bestLap,
    deletedLaps: deletedCount,
    trap,
    pitStops,
    tyre: stints && t >= input.start ? tyreState(stints, driver, currentLap) : null,
    passes: race ? { made: passesSoFar.filter((p) => p.by === driver), lost: passesSoFar.filter((p) => p.of === driver) } : { made: [], lost: [] },
    messages,
  };
}
