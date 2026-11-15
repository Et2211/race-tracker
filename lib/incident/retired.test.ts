import { describe, expect, it } from "vitest";
import type { Lap, LocationRow, SessionResult } from "@/lib/openf1/types";
import type { Trace } from "@/lib/session/telemetry";
import { fixture } from "@/test/fixtures";
import { isRetiredAt, retirements } from "./retired";

const SLUG = "2026-madrid-race";
const at = (iso: string) => Date.parse(iso);

function traceOf(rows: LocationRow[], driver: number): Trace {
  const mine = rows.filter((r) => r.driver_number === driver).sort((a, b) => a.date.localeCompare(b.date));
  return { t: Float64Array.from(mine.map((r) => Date.parse(r.date))), x: Float64Array.from(mine.map((r) => r.x)), y: Float64Array.from(mine.map((r) => r.y)) };
}

/** A trace sampled every `step` ms with x from `x(i)`, the way OpenF1 sends a few samples a second. */
function every(step: number, count: number, x: (i: number) => number): Trace {
  return { t: Float64Array.from({ length: count }, (_, i) => i * step), x: Float64Array.from({ length: count }, (_, i) => x(i)), y: new Float64Array(count) };
}

describe("retired cars", () => {
  const retired = retirements(fixture<SessionResult[]>(SLUG, "session_result"), fixture<Lap[]>(SLUG, "laps"));
  const rows = fixture<LocationRow[]>(SLUG, "location.lap14-vsc-double-yellow-s5");

  it("lists the four retirements with the start of the lap each retired on", () => {
    expect([...retired.keys()].sort((a, b) => a - b)).toEqual([11, 18, 44, 55]);
    expect(retired.get(18)).toBe(at("2026-09-13T13:25:06.135Z"));
  });

  it("hides a car parked in the garage since lap 7", () => {
    expect(isRetiredAt(traceOf(rows, 44), retired.get(44)!, at("2026-09-13T13:28:00Z"))).toBe(true);
  });

  it("keeps the lap-14 stopped car on the map until it has been still for 15 s", () => {
    const trace = traceOf(rows, 18);
    // #18 crawls to a halt at about 13:26:50; the last few metres fall inside the 20 m allowance.
    expect(isRetiredAt(trace, retired.get(18)!, at("2026-09-13T13:26:44Z"))).toBe(false);
    expect(isRetiredAt(trace, retired.get(18)!, at("2026-09-13T13:26:50Z"))).toBe(false);
    expect(isRetiredAt(trace, retired.get(18)!, at("2026-09-13T13:26:56Z"))).toBe(true);
  });

  it("never hides a car that is still running, even when it is stationary", () => {
    const parked = every(1000, 41, () => 0);
    expect(isRetiredAt(parked, 50_000, 40_000)).toBe(false); // final lap not reached
    expect(isRetiredAt(parked, 0, 40_000)).toBe(true);
  });

  it("keeps a retired car drawn while it is still moving", () => {
    const rolling = every(1000, 31, (i) => i * 70); // 7 m a second: pushed or limping

    expect(isRetiredAt(rolling, 0, 30_000)).toBe(false);
  });
});
