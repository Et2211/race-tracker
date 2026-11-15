import { describe, expect, it } from "vitest";
import type { Meeting } from "@/lib/openf1/types";
import { fixture, raceControl } from "@/test/fixtures";
import { incidentsNear, namedIncidents } from "./messages";

describe("namedIncidents", () => {
  const meeting = fixture<Meeting & { gmt_offset: string }>("2026-madrid-race", "meeting");
  const incidents = namedIncidents(raceControl("2026-madrid-race"), meeting.gmt_offset);

  it("reads cars, turn and local incident time", () => {
    const sai = incidents.find((i) => i.message.startsWith("TURN 5 INCIDENT INVOLVING CARS 55 (SAI) AND 14 (ALO)"))!;
    expect(sai.drivers).toEqual([55, 14]);
    expect(sai.turn).toBe(5);
    // 15:23:42 in Madrid (UTC+2) is 13:23:42 UTC.
    expect(new Date(sai.happenedAt!).toISOString()).toBe("2026-09-13T13:23:42.000Z");
  });

  it("leaves out offences that are not on-track incidents", () => {
    expect(incidents.some((i) => /YELLOW FLAG INFRINGEMENT|SPEEDING IN THE PIT LANE|LEAVING THE TRACK/.test(i.message))).toBe(false);
  });

  it("finds the incidents around a flag", () => {
    const near = incidentsNear(incidents, Date.parse("2026-09-13T13:04:15Z"));
    expect(near.flatMap((i) => i.drivers)).toEqual(expect.arrayContaining([55, 22]));
  });
});
