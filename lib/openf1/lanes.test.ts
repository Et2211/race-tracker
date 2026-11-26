import { describe, expect, it } from "vitest";
import { BackgroundGate } from "./lanes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Five requests at once, each taking 20 ms; returns how many ran together at most and when each started. */
async function burst(gate: BackgroundGate, throttled: boolean) {
  let running = 0;
  let most = 0;
  const starts: number[] = [];
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: 5 }, () =>
      gate.run(throttled, async () => {
        starts.push(Date.now() - t0);
        most = Math.max(most, ++running);
        await sleep(20);
        running--;
      }),
    ),
  );
  return { most, starts };
}

describe("background requests while a session is live", () => {
  it("go one at a time, spaced, while live", async () => {
    const { most, starts } = await burst(new BackgroundGate(50), true);
    expect(most).toBe(1);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(45);
  });

  it("are not held back outside sessions", async () => {
    const { most } = await burst(new BackgroundGate(50), false);
    expect(most).toBe(5);
  });

  it("keep going after one fails", async () => {
    const gate = new BackgroundGate(10);
    await expect(gate.run(true, async () => Promise.reject(new Error("OpenF1 500")))).rejects.toThrow("OpenF1 500");
    await expect(gate.run(true, async () => "next")).resolves.toBe("next");
  });
});
