import type { Lap, RaceControl } from "@/lib/openf1/types";

export type Phase = 1 | 2 | 3;
export type Mark = "purple" | "green" | null;

export type QualifyingRow = {
  driver: number;
  position: number;
  lap: number;
  sectors: [number, number, number];
  marks: [Mark, Mark, Mark];
  /** Seconds behind the fastest lap of the phase; 0 for the fastest. */
  gap: number;
};

export type QualifyingPhase = {
  phase: Phase;
  rows: QualifyingRow[];
  /** Drivers with no valid timed lap in this phase. */
  noTime: number[];
  /** Rows after this position are eliminated. Null when nobody is (final phase, or unknown). */
  cutAfter: number | null;
};

export type IdealLap = { total: number; sectors: { time: number; driver: number }[] };

/** Start time of each phase: the first "SESSION STARTED" carrying that qualifying_phase. */
export function phaseStarts(raceControl: RaceControl[]): Partial<Record<Phase, number>> {
  const starts: Partial<Record<Phase, number>> = {};
  for (const row of raceControl) {
    const phase = row.qualifying_phase;
    if (row.message !== "SESSION STARTED" || (phase !== 1 && phase !== 2 && phase !== 3)) continue;
    const t = Date.parse(row.date);
    if (starts[phase] === undefined || t < starts[phase]!) starts[phase] = t;
  }
  return starts;
}

export type DeletedLap = { driver: number; lapNumber: number | null; time: number | null };

const DELETED = /^CAR (\d+) \([A-Z]{3}\) (?:TIME (\d+):(\d+\.\d+) |LAP )DELETED\b.*?\bLAP (\d+)\b/;
const REINSTATED = /^CAR (\d+) \([A-Z]{3}\) TIME (\d+):(\d+\.\d+) WILL BE REINSTATED/;

/**
 * Laps deleted by race control (track limits and similar). The lap data itself has no
 * deleted flag, so these messages are the only source. Reinstated times are removed again.
 */
export function deletedLaps(raceControl: RaceControl[]): DeletedLap[] {
  const out: DeletedLap[] = [];
  for (const row of raceControl) {
    const del = DELETED.exec(row.message);
    if (del) {
      out.push({
        driver: Number(del[1]),
        time: del[2] ? Number(del[2]) * 60 + Number(del[3]) : null,
        lapNumber: Number(del[4]),
      });
      continue;
    }
    const back = REINSTATED.exec(row.message);
    if (back) {
      const time = Number(back[2]) * 60 + Number(back[3]);
      const i = out.findIndex((d) => d.driver === Number(back[1]) && d.time !== null && Math.abs(d.time - time) < 0.0005);
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}

function isDeleted(lap: Lap, deleted: DeletedLap[]): boolean {
  return deleted.some((d) => {
    if (d.driver !== lap.driver_number) return false;
    // A quoted time identifies the lap exactly; otherwise fall back to the lap number.
    if (d.time !== null) return lap.lap_duration !== null && Math.abs(lap.lap_duration - d.time) < 0.0005;
    return d.lapNumber === lap.lap_number;
  });
}

type TimedLap = Lap & { date_start: string; lap_duration: number; duration_sector_1: number; duration_sector_2: number; duration_sector_3: number };

const isTimed = (lap: Lap): lap is TimedLap =>
  lap.date_start !== null &&
  lap.lap_duration !== null &&
  lap.duration_sector_1 !== null &&
  lap.duration_sector_2 !== null &&
  lap.duration_sector_3 !== null;

function phaseOf(t: number, starts: Partial<Record<Phase, number>>): Phase | null {
  let phase: Phase | null = null;
  for (const p of [1, 2, 3] as const) if (starts[p] !== undefined && t >= starts[p]!) phase = p;
  return phase;
}

export function buildQualifying(laps: Lap[], raceControl: RaceControl[]): { phases: QualifyingPhase[]; ideal: IdealLap | null } {
  const starts = phaseStarts(raceControl);
  const deleted = deletedLaps(raceControl);
  const valid = laps.filter(isTimed).filter((lap) => !lap.is_pit_out_lap && !isDeleted(lap, deleted));

  // Session-wide personal and overall bests per sector, from valid laps only.
  const personal = new Map<number, [number, number, number]>();
  const overall: { time: number; driver: number }[] = [1, 2, 3].map(() => ({ time: Infinity, driver: 0 }));
  for (const lap of valid) {
    const s = [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3];
    const pb = personal.get(lap.driver_number) ?? [Infinity, Infinity, Infinity];
    s.forEach((time, i) => {
      if (time < pb[i]) pb[i] = time;
      if (time < overall[i].time) overall[i] = { time, driver: lap.driver_number };
    });
    personal.set(lap.driver_number, pb);
  }

  // Everyone who left the pits in a phase took part in it, timed lap or not.
  const participants: Record<Phase, Set<number>> = { 1: new Set(), 2: new Set(), 3: new Set() };
  for (const lap of laps) {
    if (!lap.date_start) continue;
    const phase = phaseOf(Date.parse(lap.date_start), starts);
    if (phase) participants[phase].add(lap.driver_number);
  }

  const phases = ([1, 2, 3] as const)
    .filter((phase) => starts[phase] !== undefined)
    .map((phase): QualifyingPhase => {
      const best = new Map<number, TimedLap>();
      for (const lap of valid) {
        if (phaseOf(Date.parse(lap.date_start), starts) !== phase) continue;
        const current = best.get(lap.driver_number);
        if (!current || lap.lap_duration < current.lap_duration) best.set(lap.driver_number, lap);
      }
      const ordered = [...best.values()].sort((a, b) => a.lap_duration - b.lap_duration);
      const fastest = [1, 2, 3].map((n) =>
        Math.min(...ordered.map((lap) => [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3][n - 1])),
      );
      const rows = ordered.map((lap, i): QualifyingRow => {
        const sectors: [number, number, number] = [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3];
        const pb = personal.get(lap.driver_number)!;
        const marks = sectors.map((time, n): Mark => (time === fastest[n] ? "purple" : time === pb[n] ? "green" : null)) as [Mark, Mark, Mark];
        return { driver: lap.driver_number, position: i + 1, lap: lap.lap_duration, sectors, marks, gap: lap.lap_duration - ordered[0].lap_duration };
      });
      const next = phase === 3 ? null : participants[(phase + 1) as Phase];
      const advancing = next && next.size > 0 ? next.size : null;
      return {
        phase,
        rows,
        noTime: [...participants[phase]].filter((d) => !best.has(d)).sort((a, b) => a - b),
        cutAfter: advancing !== null && advancing < participants[phase].size ? advancing : null,
      };
    });

  const ideal = overall.every((s) => Number.isFinite(s.time)) ? { total: overall.reduce((sum, s) => sum + s.time, 0), sectors: overall } : null;
  return { phases, ideal };
}
