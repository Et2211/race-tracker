import { describe, expect, it } from "vitest";
import type { Lap, PitRow, Stint } from "@/lib/openf1/types";
import { fixture, raceControl } from "@/test/fixtures";
import { driverPace, neutralisedPeriods } from "./pace";

// 2026 Spanish GP race: a VSC on laps 14–15, when most of the field pitted.
const slug = "2026-madrid-race";
const rc = raceControl(slug);
const laps = fixture<Lap[]>(slug, "laps");
const stints = fixture<Stint[]>(slug, "stints");
const pits = fixture<PitRow[]>(slug, "pit");
const neutral = neutralisedPeriods(rc);
const at = (hms: string) => Date.parse(`2026-09-13T${hms}Z`);
const pace = (driver: number, t: number) => driverPace(laps, stints, rc, pits, neutral, driver, t);

describe("race pace", () => {
  it("knows when the field was neutralised", () => {
    expect(neutral).toEqual([[at("13:27:18"), at("13:29:32")]]);
  });

  it("marks the laps that don't show pace", () => {
    const p = pace(12, at("15:00:00"));
    const marked = p.laps.filter((l) => l.status !== "clean").map((l) => [l.lap, l.status]);
    expect(marked).toEqual([[1, "first"], [14, "in"], [15, "out"]]);
    expect(p.laps.filter((l) => l.deleted).map((l) => l.lap)).toEqual([6, 23]);
    // #1 stayed out through the VSC on lap 14 and pitted a lap later.
    expect(pace(1, at("15:00:00")).laps.filter((l) => l.lap >= 14 && l.lap <= 16).map((l) => l.status)).toEqual(["neutralised", "in", "out"]);
  });

  it("keeps a car's crawl back after stopping out of its pace", () => {
    // #44 stopped on track on lap 5, then got going again and crawled round before retiring.
    const p = pace(44, at("15:00:00"));
    expect(p.laps.filter((l) => l.status === "slow").map((l) => l.lap)).toEqual([5, 6]);
    expect(p.stints[0].trend).toBeNull();
  });

  it("splits stints as OpenF1 records them", () => {
    const p = pace(63, at("15:00:00"));
    expect(p.stints.map((s) => [s.compound, s.fromLap, s.toLap])).toEqual([["HARD", 1, 14], ["MEDIUM", 15, 28], ["HARD", 29, 57]]);
    for (const s of p.stints) {
      const clean = p.laps.filter((l) => l.stint === s.stint && l.status === "clean").map((l) => l.time).sort((a, b) => a - b);
      expect(s.cleanLaps).toBe(clean.length);
      expect(s.median).toBeGreaterThanOrEqual(clean[0]);
      expect(s.median).toBeLessThanOrEqual(clean.at(-1)!);
    }
  });

  it("uses nothing from after the replay time", () => {
    const t = at("13:40:00");
    const p = pace(63, t);
    expect(p.laps.every((l) => l.end <= t)).toBe(true);
    // Mid-race the second stint is still running: it ends at the last completed lap, not lap 28.
    const last = p.laps.at(-1)!.lap;
    expect(p.stints.at(-1)).toMatchObject({ compound: "MEDIUM", toLap: last });
    expect(last).toBeLessThan(28);
  });
});
