import { randomUUID } from "node:crypto";

/**
 * One download per item at a time across server instances (each Vercel function instance is a
 * separate process, so an in-memory guard is not enough). With Supabase configured, the lock is
 * a row in `download_locks`; on the disk store there is only one process, so it always succeeds.
 */
export type LockBackend = {
  claim(key: string, holder: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
  /** Keep the lock for another ttlSeconds; false if it was lost (expired and taken). */
  extend(key: string, holder: string, ttlSeconds: number): Promise<boolean>;
  running(key: string): Promise<boolean>;
};

export class DownloadBusyError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type LockOptions = {
  /** How long the lock lasts without a heartbeat; the holder renews it every third of this while it works. */
  ttlSeconds: number;
  /** How long a second request waits for someone else's download before giving up. */
  waitMs: number;
  pollMs?: number;
};

/**
 * Returns the stored item if there is one. Otherwise downloads it while holding the lock, or,
 * if another instance holds it, waits for that download to finish and reads what it stored.
 * If that download failed, the waiting request tries once more itself.
 */
export async function withDownloadLock<T>(
  backend: LockBackend,
  key: string,
  read: () => Promise<T | null>,
  download: () => Promise<T>,
  { ttlSeconds, waitMs, pollMs = 2000 }: LockOptions,
): Promise<T> {
  const holder = randomUUID();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const stored = await read();
    if (stored) return stored;
    if (await backend.claim(key, holder, ttlSeconds)) {
      const heartbeat = setInterval(() => void backend.extend(key, holder, ttlSeconds).catch(() => false), (ttlSeconds * 1000) / 3);
      try {
        return await download();
      } finally {
        clearInterval(heartbeat);
        await backend.release(key, holder).catch(() => undefined); // it expires anyway
      }
    }
    // Someone else is downloading it: check the small lock row, not the stored files.
    do {
      if (Date.now() + pollMs > deadline) throw new DownloadBusyError("This session is being downloaded by another request. Try again in a minute.");
      await sleep(pollMs);
    } while (await backend.running(key));
  }
}

export const noLocks: LockBackend = {
  claim: async () => true,
  release: async () => undefined,
  extend: async () => true,
  running: async () => false,
};
