import { describe, expect, it } from "vitest";
import { raceControl } from "@/test/fixtures";
import { flagStateAt } from "./state";

const at = (iso: string) => Date.parse(iso);

describe("flagStateAt", () => {
  const madrid = raceControl("2026-madrid-race");

  it("groups a yellow with its warning sector and names the higher sector as the incident", () => {
    const s = flagStateAt(madrid, at("2026-09-13T13:12:26Z"));
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]).toMatchObject({ flag: "YELLOW", sector: 23, sectors: [22, 23], lap: 5 });
  });

  it("clears a sector on its CLEAR message", () => {
    expect(flagStateAt(madrid, at("2026-09-13T13:12:40Z")).sectorFlags).toEqual([]);
  });

  it("tracks the virtual safety car until TRACK CLEAR", () => {
    expect(flagStateAt(madrid, at("2026-09-13T13:27:30Z")).safetyCar).toMatchObject({ kind: "VSC", ending: false });
    expect(flagStateAt(madrid, at("2026-09-13T13:29:25Z")).safetyCar).toMatchObject({ kind: "VSC", ending: true });
    expect(flagStateAt(madrid, at("2026-09-13T13:29:40Z")).safetyCar).toBeNull();
  });

  it("keeps a red flag through TRACK CLEAR until the session restarts", () => {
    const sp = raceControl("2026-sao-paulo-qualifying");
    expect(flagStateAt(sp, at("2026-11-07T18:02:30Z")).red).toBe(true);
    // "TRACK CLEAR" came at 18:05; the session only restarted at 19:26.
    expect(flagStateAt(sp, at("2026-11-07T18:30:00Z")).red).toBe(true);
    expect(flagStateAt(sp, at("2026-11-07T19:26:30Z")).red).toBe(false);
  });

  it("ends sector flags at the chequered flag", () => {
    const end = madrid.find((r) => r.flag === "CHEQUERED")!;
    expect(flagStateAt(madrid, Date.parse(end.date) + 1000).sectorFlags).toEqual([]);
  });
});
