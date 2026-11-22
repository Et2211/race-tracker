import { describe, expect, it } from "vitest";
import type { Lap, SessionResult } from "@/lib/openf1/types";
import { fixture } from "@/test/fixtures";
import { gapStory, lineCrossings } from "./gaps";

// 2026 Spanish GP race.
const slug = "2026-madrid-race";
const laps = fixture<Lap[]>(slug, "laps");
const results = fixture<SessionResult[]>(slug, "session_result");
const crossings = lineCrossings(laps);
const at = (hms: string) => Date.parse(`2026-09-13T${hms}Z`);

describe("gaps at the line", () => {
  it("gives every finisher's official place, and the lead-lap gaps to within a tenth", () => {
    for (const r of results.filter((x) => x.position !== null)) {
      const last = gapStory(crossings, r.driver_number, at("15:00:00")).at(-1)!;
      expect(last.position, `#${r.driver_number}`).toBe(r.position);
      if (typeof r.gap_to_leader === "number") expect(Math.abs(last.toLeader - r.gap_to_leader), `#${r.driver_number}`).toBeLessThan(0.1);
    }
  });

  it("names the cars either side, consistent with each other", () => {
    const story = gapStory(crossings, 63, at("15:00:00"));
    for (const g of story) {
      if (g.ahead) {
        const theirs = gapStory(crossings, g.ahead.driver, at("15:00:00")).find((x) => x.lap === g.lap)!;
        expect(theirs.behind?.driver).toBe(63);
        expect(theirs.behind!.gap).toBeCloseTo(g.ahead.gap, 6);
      }
    }
  });

  it("uses only crossings up to the replay time", () => {
    // Just after #12 finished lap 20, the car behind hadn't crossed yet.
    const crossed = crossings.get(20)!.find((c) => c.driver === 12)!.t;
    const story = gapStory(crossings, 12, crossed + 10);
    expect(story.at(-1)).toMatchObject({ lap: 20, behind: null });
    expect(story.every((g) => g.t <= crossed + 10)).toBe(true);
  });
});
