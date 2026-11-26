/**
 * While a session is live, the relay's few REST requests (filling a gap, opening the session)
 * must not wait behind a queue of downloads. OpenF1's shared schedule (openf1_grant) hands out
 * turns in order, so a burst of downloads would book every turn for the next minute. While live,
 * each server instance therefore lets its background requests out one at a time, `gapMs` apart:
 * the shared queue then holds at most about one background request per instance, and a live
 * request gets the next turn or close to it. Outside sessions nothing is held back.
 */
export class BackgroundGate {
  private tail: Promise<void> = Promise.resolve();
  private lastStart = -Infinity;

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Runs `work` straight away, or (`throttled`) after the previous one has finished and the gap has passed. */
  async run<T>(throttled: boolean, work: () => Promise<T>): Promise<T> {
    if (!throttled) return work();
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await previous;
    try {
      const wait = this.lastStart + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      return await work();
    } finally {
      release();
    }
  }
}
