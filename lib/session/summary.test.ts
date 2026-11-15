import { describe, expect, it } from "vitest";
import type { Driver, Lap, Meeting, PitRow, PositionRow, RaceControl, Session, SessionResult } from "@/lib/openf1/types";
import { assembleMeta, outlineFrom } from "@/lib/session/assemble";
import { fixture } from "@/test/fixtures";
import { circuitShape, summarize } from "./summary";
import type { LocationRow } from "@/lib/openf1/types";

function metaFor(slug: string, outline?: { file: string; driver: number; lap: number }) {
  const laps = fixture<Lap[]>(slug, "laps");
  const lap = outline ? laps.find((l) => l.driver_number === outline.driver && l.lap_number === outline.lap)! : null;
  return assembleMeta({
    session: fixture<Session>(slug, "session"),
    meeting: fixture<Meeting>(slug, "meeting"),
    drivers: fixture<Driver[]>(slug, "drivers"),
    laps,
    raceControl: fixture<RaceControl[]>(slug, "race_control"),
    positions: fixture<PositionRow[]>(slug, "position"),
    intervals: [],
    pits: fixture<PitRow[]>(slug, "pit"),
    results: fixture<SessionResult[]>(slug, "session_result"),
    outline: lap && outline ? outlineFrom(lap, fixture<LocationRow[]>(slug, `location.${outline.file}`)) : null,
    outlineNote: "",
    multiviewer: null,
    learned: null,
    qualifying: null,
    source: "fixtures",
  });
}

describe("session summary", () => {
  const race = summarize(metaFor("2026-madrid-race"));

  it("lists the official classification in order, with the winner first and no gap", () => {
    const official = fixture<SessionResult[]>("2026-madrid-race", "session_result").filter((r) => r.position).sort((a, b) => a.position! - b.position!);
    expect(race.classification.slice(0, 3).map((r) => r.driver)).toEqual(official.slice(0, 3).map((r) => r.driver_number));
    expect(race.classification[0].gap).toBeNull();
    expect(race.classification[1].gap).toMatch(/^\+\d+\.\d{3}$/);
  });

  it("counts the lap-14 VSC and the race's laps", () => {
    expect(race.incidents.vsc).toBe(1);
    expect(race.incidents.safetyCar).toBe(0);
    expect(race.laps).toBe(57);
  });

  it("finds the fastest lap of the race", () => {
    expect(race.fastestLap).toEqual({ driver: 63, lap: 49, seconds: 95.587 });
  });

  it("uses the deciding phase's gap in qualifying", () => {
    const q = summarize(metaFor("2026-sao-paulo-qualifying"));
    expect(q.kind).toBe("qualifying");
    expect(q.classification[0].gap).toBeNull();
    expect(q.fastestLap).toBeNull();
  });

  it("draws the circuit as a closed path", () => {
    const shape = circuitShape(metaFor("2026-madrid-race", { file: "outline-lap-63-49", driver: 63, lap: 49 }))!;
    expect(shape.path.startsWith("M")).toBe(true);
    expect(shape.path.endsWith("Z")).toBe(true);
    expect(shape.circuitKey).toBe(153);
  });
});
