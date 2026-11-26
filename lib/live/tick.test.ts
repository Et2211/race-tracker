import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encodeBucket, type StoredBucket } from "./buckets";
import { liveStore, type LiveStore } from "./store";
import { planTick, type Cursors, type Tick } from "./sync";
import { buildTick, sharedTick, TICK_WINDOW_S } from "./tick";

const bucket = (second: number, samples: number): StoredBucket => ({ ...encodeBucket({ second, location: [], carData: [] }), samples });

/**
 * A viewer as the browser runs it: opens with everything stored so far, then reads ticks through
 * a CDN that may answer with a copy up to `staleness` ticks old, following `?after=` as told.
 * Keeps the newest revision it has applied for each record and second, to compare with the store.
 */
function viewer(store: LiveStore, session: number, staleness: number, held: boolean) {
  let stale = staleness;
  const rows = new Map<string, number>();
  const seconds = new Map<number, number>();
  let cursors: Cursors | null = null;
  const cache = new Map<string, Tick[]>();
  let behindCount = 0;
  const fetchTick = async (after: number | null, buckets: number) => {
    const key = String(after);
    const fresh = after === null && held ? await sharedTick(store, session, buckets) : await buildTick(store, session, after, buckets);
    const kept = [fresh, ...(cache.get(key) ?? [])].slice(0, staleness + 1);
    cache.set(key, kept);
    return kept[Math.floor(Math.random() * Math.min(kept.length, stale + 1))]; // any copy the CDN might still hold
  };
  return {
    rows,
    seconds,
    /** Once writes stop, the CDN's copies expire and it answers with the current tick. */
    settle() {
      stale = 0;
    },
    get behindCount() {
      return behindCount;
    },
    async open() {
      const status = await store.status(session);
      const all = await store.rowsSince(session, 0);
      for (const r of all) rows.set(`${r.topic}|${r.key}`, r.rev);
      for (const b of await store.bucketsSince(session, 0)) seconds.set(b.second, b.rev);
      cursors = { rows: status.lastRev, buckets: status.lastBucketRev };
    },
    async poll(buckets = 30) {
      let after: number | null = null;
      for (let guard = 0; guard < 200; guard++) {
        const tick = await fetchTick(after, buckets);
        const plan = planTick(cursors!, tick);
        if ("behind" in plan) {
          behindCount++;
          after = plan.next;
          continue;
        }
        for (const r of plan.rows) rows.set(`${r.topic}|${(r.payload as { key: string }).key}`, r.rev);
        for (const c of tick.chunks.filter((x) => x.rev > cursors!.buckets)) seconds.set(c.chunk.from / 1000, c.rev);
        cursors = plan.cursors;
        if (plan.next === null) return;
        after = plan.next;
      }
      throw new Error("never caught up");
    },
  };
}

/** What the store holds now: the current revision of every record and second. */
async function stored(store: LiveStore, session: number) {
  const rows = new Map<string, number>();
  const seconds = new Map<number, number>();
  for (let rev = 0; ; ) {
    const page = await store.rowsSince(session, rev);
    if (!page.length) break;
    for (const r of page) rows.set(`${r.topic}|${r.key}`, r.rev);
    rev = page[page.length - 1].rev;
  }
  for (let rev = 0; ; ) {
    const page = await store.bucketsSince(session, rev);
    if (!page.length) break;
    for (const b of page) seconds.set(b.second, b.rev);
    rev = page[page.length - 1].rev;
  }
  return { rows, seconds };
}

describe("the shared live tick", () => {
  it.each([
    ["read whole each time", false, 900_001],
    ["held by the server instance", true, 900_003],
  ])("brings every viewer to exactly what is stored, from cached copies, bursts and all (%s)", async (_name, held, session) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const store = liveStore();
    await store.clear(session);
    const t0 = 1_800_000_000;
    let second = t0;
    const write = async () => {
      await store.putBuckets(session, [bucket(second, 10)]);
      // Positions change every second; a lap record now and then gets a newer version.
      await store.upsertRows(session, [
        { topic: "position", key: `1|${second}`, msg_id: second, payload: { key: `1|${second}` } },
        { topic: "laps", key: `1|${second % 7}`, msg_id: second, payload: { key: `1|${second % 7}`, at: second } },
      ]);
      second++;
      vi.setSystemTime(Date.now() + 1000); // a second passes: the instance's copy expires
    };
    for (let i = 0; i < 20; i++) await write();
    const viewers = [viewer(store, session, 0, held), viewer(store, session, 2, held), viewer(store, session, 2, held)];
    for (const v of viewers) await v.open();
    for (let i = 0; i < 60; i++) {
      await write();
      // A relay fills a gap: ninety earlier seconds improved at once, far more than one answer holds.
      if (i === 30) await store.putBuckets(session, Array.from({ length: 90 }, (_, k) => bucket(t0 - 100 + k, 5)));
      // The others poll only every 15 seconds, as if on a slow connection or a tab in the background.
      for (const [n, v] of viewers.entries()) if (n === 0 || i % 15 === 0) await v.poll(8);
    }
    for (const v of viewers) {
      v.settle();
      await v.poll(8);
    }
    const truth = await stored(store, session);
    for (const v of viewers) {
      expect(v.rows).toEqual(truth.rows);
      expect(v.seconds).toEqual(truth.seconds);
    }
    // The viewer reading every tick never fell outside the window; the slow ones did, and caught up.
    expect(viewers[0].behindCount).toBe(0);
    expect(viewers[1].behindCount + viewers[2].behindCount).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("holds about the last ten seconds of car data", async () => {
    const store = liveStore();
    const session = 900_002;
    await store.clear(session);
    for (let s = 0; s < 40; s++) await store.putBuckets(session, [bucket(1_800_000_000 + s, 10)]);
    const tick = await buildTick(store, session, null);
    expect(tick.chunks.length).toBe(TICK_WINDOW_S);
    expect(tick.more).toBe(false);
  });

  it("sends a viewer that has fallen behind to its own catch-up", () => {
    const tick: Tick = { from: 100, head: 120, more: false, rows: [], chunks: [], status: null };
    expect(planTick({ rows: 90, buckets: 130 }, tick)).toEqual({ behind: true, next: 90 });
    expect(planTick({ rows: 100, buckets: 110 }, tick)).toMatchObject({ cursors: { rows: 120, buckets: 120 }, next: null });
  });
});
