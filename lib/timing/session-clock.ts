import type { Lap, RaceControl } from "@/lib/openf1/types";
import type { Phase } from "./qualifying";

/**
 * The qualifying clock: how long is left in the running phase, from race control's markers.
 * SESSION STARTED starts or restarts a phase's clock, SESSION ABORTED or a red flag stops it,
 * SESSION FINISHED ends the phase. A phase's length comes from the data when it ran to the end
 * (the clock time it actually ran), else from the format: Q1 18, Q2 15, Q3 13 minutes (12
 * before 2026); sprint qualifying 12, 10, 8.
 */
export type QualifyingClock =
  | { state: "before"; phase: Phase; startsAt: number | null }
  | { state: "running" | "stopped"; phase: Phase; remainingMs: number }
  | { state: "break"; finished: Phase; next: Phase; startsAt: number | null }
  | { state: "over" };

const MIN = 60_000;
export function phaseLength(phase: Phase, sprint: boolean, year: number): number {
  if (sprint) return [12, 10, 8][phase - 1] * MIN;
  return [18, 15, year >= 2026 ? 13 : 12][phase - 1] * MIN;
}

type Marker = { t: number; phase: Phase | null; kind: "start" | "stop" | "finish" };

function markers(raceControl: RaceControl[]): Marker[] {
  const out: Marker[] = [];
  let lastPhase: Phase | null = null;
  for (const r of raceControl) {
    const phase: Phase | null = r.qualifying_phase === 1 || r.qualifying_phase === 2 || r.qualifying_phase === 3 ? r.qualifying_phase : lastPhase;
    const t = Date.parse(r.date);
    if (r.message === "SESSION STARTED") out.push({ t, phase, kind: "start" });
    else if (r.message === "SESSION ABORTED" || r.flag === "RED") out.push({ t, phase, kind: "stop" });
    else if (r.message === "SESSION FINISHED") out.push({ t, phase, kind: "finish" });
    else continue;
    lastPhase = phase;
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Per phase: when it ran ([start, end) stretches), and when it finished. */
function phaseRuns(raceControl: RaceControl[]) {
  const runs = new Map<Phase, { stretches: [number, number][]; finishedAt: number | null; finishedRunning: boolean }>();
  let open: { phase: Phase; from: number } | null = null;
  for (const m of markers(raceControl)) {
    if (m.phase === null) continue;
    const r = runs.get(m.phase) ?? { stretches: [], finishedAt: null, finishedRunning: false };
    runs.set(m.phase, r);
    if (m.kind === "start") {
      if (!open) open = { phase: m.phase, from: m.t };
    } else {
      if (open && open.phase === m.phase) {
        r.stretches.push([open.from, m.t]);
        if (m.kind === "finish") r.finishedRunning = true;
        open = null;
      }
      if (m.kind === "finish") r.finishedAt = m.t;
    }
  }
  if (open) runs.get(open.phase)!.stretches.push([open.from, Infinity]);
  return runs;
}

export function qualifyingClock(raceControl: RaceControl[], t: number, sprint: boolean, year: number): QualifyingClock {
  const runs = phaseRuns(raceControl);
  const startOf = (p: Phase) => runs.get(p)?.stretches[0]?.[0] ?? null;
  for (const phase of [1, 2, 3] as Phase[]) {
    const r = runs.get(phase);
    const start = startOf(phase);
    if (start === null || t < start) {
      if (phase === 1) return { state: "before", phase: 1, startsAt: start };
      return { state: "break", finished: (phase - 1) as Phase, next: phase, startsAt: start };
    }
    if (r!.finishedAt !== null && t >= r!.finishedAt) continue; // this phase is over; look at the next
    const ranMs = r!.stretches.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, t) - a), 0);
    const total = r!.finishedRunning ? r!.stretches.reduce((sum, [a, b]) => sum + (b - a), 0) : phaseLength(phase, sprint, year);
    const running = r!.stretches.some(([a, b]) => t >= a && t < b);
    return { state: running ? "running" : "stopped", phase, remainingMs: Math.max(0, total - ranMs) };
  }
  return { state: "over" };
}

/**
 * Stretches of a qualifying session with nothing on track worth watching, which playback can
 * skip: each break between phases (from the last lap started before the flag being completed to
 * 20 s before the next phase), and each red-flag stoppage (from 30 s after the flag to 20 s
 * before the restart). Only stretches longer than a minute are returned.
 */
export function quietStretches(raceControl: RaceControl[], laps: Lap[]): [number, number][] {
  const runs = phaseRuns(raceControl);
  const out: [number, number][] = [];
  const lapEnds = laps.flatMap((l) => (l.date_start && l.lap_duration !== null ? [{ start: Date.parse(l.date_start), end: Date.parse(l.date_start) + l.lap_duration * 1000 }] : []));
  const phases = ([1, 2, 3] as Phase[]).filter((p) => runs.get(p)?.stretches.length);
  phases.forEach((p, i) => {
    const r = runs.get(p)!;
    // Red-flag stoppages within the phase.
    for (let s = 0; s + 1 < r.stretches.length; s++) out.push([r.stretches[s][1] + 30_000, r.stretches[s + 1][0] - 20_000]);
    // The break before the next phase, once the last cars have finished their final laps.
    const next = phases[i + 1];
    if (next !== undefined && r.finishedAt !== null) {
      // Laps under way at the flag end within a couple of minutes; slow laps back to the pits (or
      // laps with no time) may not, so nothing later than three minutes after the flag counts.
      const finalLaps = lapEnds.filter((l) => l.start < r.finishedAt! && l.end <= r.finishedAt! + 180_000).map((l) => l.end);
      const last = Math.max(r.finishedAt, ...finalLaps);
      out.push([last + 15_000, runs.get(next)!.stretches[0][0] - 20_000]);
    }
  });
  return out.filter(([a, b]) => b - a > 60_000);
}
