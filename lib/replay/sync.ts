import type { Lap, RaceControl } from "@/lib/openf1/types";
import type { SessionKind } from "@/lib/session/types";
import { phaseStarts, type Phase } from "@/lib/timing/qualifying";
import { lapStarts } from "./timeline";

/** A moment a viewer can see on the broadcast, with its session time. */
export type SyncPoint = { id: string; label: string; short: string; t: number };

/**
 * Moments to line the replay up with a recording of the broadcast.
 * Race: lights out (race control's SESSION STARTED, which is also when every car's first lap
 * starts), then each lap as the leader crosses the line, when the TV lap counter goes up.
 * Qualifying: the start of each phase, when the pit exit opens and the session clock starts.
 */
export function syncPoints(kind: SessionKind, laps: Lap[], raceControl: RaceControl[], sessionName: string): SyncPoint[] {
  if (kind === "practice") {
    // The pit exit opening is the one moment the broadcast always shows.
    const started = raceControl.find((r) => r.message === "SESSION STARTED");
    return started ? [{ id: "start", label: "Session starts (pit exit opens)", short: "the start of the session", t: Date.parse(started.date) }] : [];
  }
  if (kind === "qualifying") {
    const prefix = sessionName.startsWith("Sprint") ? "SQ" : "Q";
    const starts = phaseStarts(raceControl);
    return ([1, 2, 3] as Phase[])
      .filter((p) => starts[p] !== undefined)
      .map((p) => ({ id: `phase-${p}`, label: `${prefix}${p} starts (pit exit opens)`, short: `the start of ${prefix}${p}`, t: starts[p]! }));
  }
  if (kind !== "race") return [];
  const started = raceControl.find((r) => r.message === "SESSION STARTED");
  const laps1 = lapStarts(laps);
  const lightsOut = started ? Date.parse(started.date) : laps1.get(1);
  const points: SyncPoint[] = lightsOut === undefined ? [] : [{ id: "lights-out", label: "Lights out", short: "lights out", t: lightsOut }];
  for (const [lap, t] of [...laps1].sort((a, b) => a[0] - b[0])) {
    if (lap >= 2) points.push({ id: `lap-${lap}`, label: `Lap ${lap} begins (leader crosses the line)`, short: `the start of lap ${lap}`, t });
  }
  return points;
}

/** Reaction time: pressing "Now" lands this long after the moment itself. */
export const REACTION_MS = 250;
