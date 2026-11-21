import { describe, expect, it } from "vitest";
import { liveTime, smoothedDelay } from "./use-live-clock";

describe("live clock", () => {
  it("shows real time minus the delay, but never past the newest data", () => {
    expect(liveTime(100_000, 30_000, 90_000, null)).toBe(70_000);
    expect(liveTime(100_000, 0, 90_000, null)).toBe(90_000);
    expect(liveTime(100_000, 30_000, null, null)).toBe(70_000);
  });

  it("holds the paused time", () => expect(liveTime(100_000, 0, 95_000, 80_000)).toBe(80_000));

  it("places the clock inside the margins when it opens", () => {
    // Opening, with no delay yet, puts the clock 10 s past the data: it is set 2.25 s behind it at once.
    const d = smoothedDelay(100_000, 0, 90_000);
    expect(90_000 - (100_000 - d)).toBe(2250);
    // A delay already behind the data is left alone (a synced stream's delay stays put).
    expect(smoothedDelay(100_000, 40_000, 90_000)).toBe(40_000);
  });

  it("never moves the time shown backwards when it catches up with the data", () => {
    // Half a second behind the data (closer than the low margin): over a 100 ms frame the delay
    // grows by 20 ms, so the clock runs at 0.8x rather than jumping back.
    const before = liveTime(100_000, 10_500, 90_000, null);
    const d = smoothedDelay(100_100, 10_500, 90_000, 100, 0);
    expect(d).toBe(10_520);
    expect(liveTime(100_100, d, 90_000, null) - before).toBe(80);
    // Frame after frame, a clock that runs into the data (nothing new for 5 s) stands still there and never goes backwards.
    let delay = 10_500, last = -Infinity;
    for (let now = 100_000; now < 105_000; now += 16) {
      delay = smoothedDelay(now, delay, 90_000, 16, 0);
      const t = liveTime(now, delay, 90_000, null);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });

  it("leaves the clock alone between the margins, and eases it back in from outside", () => {
    expect(smoothedDelay(100_000, 12_000, 90_000, 100, 0)).toBe(12_000); // 2 s behind the data
    expect(smoothedDelay(100_000, 11_000, 90_000, 100, 0)).toBe(11_020); // 1 s: closer than the low margin
    expect(smoothedDelay(100_000, 16_000, 90_000, 100, 0)).toBe(15_980); // 6 s: further than the high margin
    expect(smoothedDelay(100_000, 16_000, 90_000, 100, null)).toBe(16_000); // scrolled back or resumed after a pause
  });

  it("works back to the synced delay once the data allows, never closer than the margin", () => {
    // Synced 5 s behind real time, but the data was 10 s behind, so the clock had to wait at 11 s.
    // The data has caught up (3 s behind): back towards 5 s.
    expect(smoothedDelay(100_000, 11_000, 97_000, 100, 5_000)).toBe(10_980);
    // Within a quarter second of the synced delay: stays put.
    expect(smoothedDelay(100_000, 5_100, 97_000, 100, 5_000)).toBe(5_100);
    // The data is still 10 s behind: it runs no closer to it than the low margin, whatever the synced delay.
    expect(smoothedDelay(100_000, 11_500, 90_000, 100, 5_000)).toBe(11_500);
  });
});
