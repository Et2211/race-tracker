import type { Lap, RaceControl } from "@/lib/openf1/types";
import type { SessionKind } from "@/lib/session/types";
import { phaseStarts, type Phase } from "@/lib/timing/qualifying";

/** Start of each race lap: the moment the first car began it (the leader crossing the line). */
export function lapStarts(laps: Lap[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const lap of laps) {
    if (!lap.date_start) continue;
    const t = Date.parse(lap.date_start);
    const current = out.get(lap.lap_number);
    if (current === undefined || t < current) out.set(lap.lap_number, t);
  }
  return out;
}

export type JumpTarget = { label: string; t: number };

/** Places the replay can jump to: each lap of a race, or the start of each qualifying phase. */
export function jumpTargets(kind: SessionKind, laps: Lap[], raceControl: RaceControl[], sessionName: string): JumpTarget[] {
  if (kind === "practice") return []; // laps are each driver's own runs: nothing session-wide to jump to
  if (kind === "qualifying") {
    const prefix = sessionName.startsWith("Sprint") ? "SQ" : "Q";
    const starts = phaseStarts(raceControl);
    return ([1, 2, 3] as Phase[]).filter((p) => starts[p] !== undefined).map((p) => ({ label: `${prefix}${p}`, t: starts[p]! }));
  }
  return [...lapStarts(laps)].sort((a, b) => a[0] - b[0]).map(([n, t]) => ({ label: `Lap ${n}`, t }));
}

export const clamp = (t: number, span: { start: number; end: number }) => Math.min(span.end, Math.max(span.start, t));
