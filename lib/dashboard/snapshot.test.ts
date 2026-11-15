import { describe, expect, it } from "vitest";
import type { Driver, Lap, Meeting, PitRow, PositionRow, RaceControl, Session, SessionResult } from "@/lib/openf1/types";
import { assembleMeta } from "@/lib/session/assemble";
import { TelemetryIndex } from "@/lib/session/telemetry";
import { fixture } from "@/test/fixtures";
import { buildSnapshot, buildStatic } from "./snapshot";

const slug = "2026-madrid-race";
const meta = assembleMeta({
  session: fixture<Session>(slug, "session"),
  meeting: fixture<Meeting>(slug, "meeting"),
  drivers: fixture<Driver[]>(slug, "drivers"),
  laps: fixture<Lap[]>(slug, "laps"),
  raceControl: fixture<RaceControl[]>(slug, "race_control"),
  positions: fixture<PositionRow[]>(slug, "position"),
  intervals: [],
  pits: fixture<PitRow[]>(slug, "pit"),
  results: fixture<SessionResult[]>(slug, "session_result"),
  outline: null,
  outlineNote: "",
  multiviewer: null,
  learned: null,
  qualifying: null,
  source: "fixtures",
});
const view = buildStatic(meta);
const at = (iso: string) => buildSnapshot(meta, view, new TelemetryIndex(), Date.parse(iso));

describe("before lights out", () => {
  // Lights out ("SESSION STARTED", and every car's lap 1) was at 13:04:04.248.
  it("is not part of lap 1, and pre-race messages are not labelled lap 1", () => {
    const s = at("2026-09-13T13:02:00Z");
    expect(s.beforeStart).toBe(true);
    expect(s.lap).toBe(0);
    expect(s.log.length).toBeGreaterThan(0);
    for (const entry of s.log) {
      expect(entry.pre).toBe(true);
      expect(entry.lap).toBeNull();
    }
  });

  it("ends at lights out", () => {
    const s = at("2026-09-13T13:04:05Z");
    expect(s.beforeStart).toBe(false);
    expect(s.lap).toBe(1);
  });
});
