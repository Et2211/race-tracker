import { describe, expect, it } from "vitest";
import type { Lap, RaceControl } from "@/lib/openf1/types";
import { fixture } from "@/test/fixtures";
import { syncPoints } from "./sync";

describe("sync points", () => {
  it("starts a race at lights out, then each lap as the leader crosses the line", () => {
    const points = syncPoints("race", fixture<Lap[]>("2026-madrid-race", "laps"), fixture<RaceControl[]>("2026-madrid-race", "race_control"), "Race");
    expect(points[0]).toEqual({ id: "lights-out", label: "Lights out", short: "lights out", t: Date.parse("2026-09-13T13:04:04.248Z") });
    expect(points[1]).toMatchObject({ id: "lap-2", t: Date.parse("2026-09-13T13:05:46.383Z") });
    expect(points.at(-1)!.id).toBe("lap-57");
    expect(points.map((p) => p.t)).toEqual([...points.map((p) => p.t)].sort((a, b) => a - b));
  });

  it("offers each qualifying phase start", () => {
    const points = syncPoints("qualifying", fixture<Lap[]>("2026-sao-paulo-qualifying", "laps"), fixture<RaceControl[]>("2026-sao-paulo-qualifying", "race_control"), "Qualifying");
    expect(points.map((p) => p.id)).toEqual(["phase-1", "phase-2", "phase-3"]);
    expect(points[0].label).toBe("Q1 starts (pit exit opens)");
  });
});
