import { describe, expect, it } from "vitest";
import { liveTime, smoothedDelay } from "./use-live-clock";

describe("live clock", () => {
  it("shows real time minus the delay, but never past the newest data", () => {
    expect(liveTime(100_000, 30_000, 90_000, null)).toBe(70_000);
    expect(liveTime(100_000, 0, 90_000, null)).toBe(90_000);
    expect(liveTime(100_000, 30_000, null, null)).toBe(70_000);
  });

  it("holds the paused time", () => expect(liveTime(100_000, 0, 95_000, 80_000)).toBe(80_000));

  it("moves the delay back when it catches up with the data, so it runs smoothly between polls", () => {
    // Data reaches 90 s; with no delay the clock would sit on 90 s and jump each second.
    const d = smoothedDelay(100_000, 0, 90_000);
    expect(100_000 - d).toBeLessThan(90_000);
    // Real time moves on half a second before the next data: the time shown moves too.
    expect(liveTime(100_500, d, 90_000, null)).toBeGreaterThan(liveTime(100_000, d, 90_000, null));
    // A delay already behind the data is left alone (a synced stream's delay stays put).
    expect(smoothedDelay(100_000, 40_000, 90_000)).toBe(40_000);
  });

  it("catches up at 1.5x speed while following live after falling behind, and not otherwise", () => {
    // 6 s behind the data while following: each 100 ms frame takes 50 ms off the delay.
    expect(smoothedDelay(100_000, 16_000, 90_000, 100, true)).toBe(15_950);
    expect(smoothedDelay(100_000, 16_000, 90_000, 100, false)).toBe(16_000); // synced or scrolled back
    // About a second behind is where it settles.
    expect(smoothedDelay(100_000, 11_000, 90_000, 100, true)).toBe(11_000);
  });
});
