import { describe, expect, it } from "vitest";
import type { Lap, RaceControl } from "@/lib/openf1/types";
import { fixture } from "@/test/fixtures";
import { qualifyingClock, quietStretches } from "./session-clock";

// São Paulo 2026: Q1 red-flagged after 2:23 and restarted; Q2 red-flagged at 14:17 and never resumed.
const rc = fixture<RaceControl[]>("2026-sao-paulo-qualifying", "race_control");
const laps = fixture<Lap[]>("2026-sao-paulo-qualifying", "laps");
const at = (hms: string) => Date.parse(`2026-11-07T${hms}Z`);
/** The clock as shown: to the second. */
const clock = (hms: string) => {
  const c = qualifyingClock(rc, at(hms), false, 2026);
  if ("remainingMs" in c) return { ...c, remainingMs: Math.round(c.remainingMs / 1000) * 1000 };
  if ("startsAt" in c && c.startsAt !== null) return { ...c, startsAt: Math.round(c.startsAt / 1000) * 1000 };
  return c;
};

describe("qualifying clock", () => {
  it("counts down while a phase runs and stops under a red flag", () => {
    expect(clock("17:59:00")).toMatchObject({ state: "before", phase: 1 });
    expect(clock("18:01:00")).toEqual({ state: "running", phase: 1, remainingMs: 17 * 60_000 });
    expect(clock("18:30:00")).toEqual({ state: "stopped", phase: 1, remainingMs: (18 * 60 - 143) * 1000 });
    expect(clock("19:30:00")).toEqual({ state: "running", phase: 1, remainingMs: (18 * 60 - 143 - 240) * 1000 });
  });

  it("shows the break and when the next phase starts", () => {
    expect(clock("19:47:00")).toEqual({ state: "break", finished: 1, next: 2, startsAt: at("19:49:00") });
  });

  it("keeps the time left when a phase is stopped and never resumed", () => {
    // Q2 is 15 minutes; it ran 14:17 before the red flag.
    expect(clock("20:04:00")).toEqual({ state: "stopped", phase: 2, remainingMs: 42_000 }); // 14:17.8 run, so 0:42 left
    expect(clock("20:07:00")).toMatchObject({ state: "break", finished: 2, next: 3 });
  });

  it("is over after Q3", () => {
    expect(clock("20:13:59")).toMatchObject({ state: "break", next: 3 });
    expect(clock("20:20:00")).toEqual({ state: "running", phase: 3, remainingMs: 7 * 60_000 });
    expect(clock("20:40:00")).toEqual({ state: "over" });
  });
});

describe("quiet stretches", () => {
  it("cover the Q1 red flag and the breaks between phases, and nothing while cars run", () => {
    const quiet = quietStretches(rc, laps);
    const inQuiet = (hms: string) => quiet.some(([a, b]) => at(hms) >= a && at(hms) < b);
    expect(inQuiet("18:30:00")).toBe(true); // Q1 red flag
    expect(inQuiet("19:47:00")).toBe(true); // break before Q2
    expect(inQuiet("20:10:00")).toBe(true); // break before Q3
    expect(inQuiet("18:01:00")).toBe(false);
    expect(inQuiet("19:30:00")).toBe(false);
    expect(inQuiet("20:20:00")).toBe(false);
    // Stops before the restart, so the restart itself is shown.
    expect(inQuiet("19:25:50")).toBe(false);
  });
});
