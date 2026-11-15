import { describe, expect, it } from "vitest";
import { DownloadBusyError, withDownloadLock, type LockBackend } from "./download-lock";

/** The lock table, shared by "instances" the way the database row is. */
function table(): LockBackend & { claims: number } {
  const rows = new Map<string, { holder: string; expires: number }>();
  const api = {
    claims: 0,
    async claim(key: string, holder: string, ttl: number) {
      const row = rows.get(key);
      if (row && row.expires >= Date.now()) return false;
      rows.set(key, { holder, expires: Date.now() + ttl * 1000 });
      api.claims++;
      return true;
    },
    async release(key: string, holder: string) {
      if (rows.get(key)?.holder === holder) rows.delete(key);
    },
    async running(key: string) {
      const row = rows.get(key);
      return Boolean(row && row.expires >= Date.now());
    },
  };
  return api;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opts = { ttlSeconds: 60, waitMs: 2000, pollMs: 10 };

describe("download lock", () => {
  it("downloads once when two instances ask at the same time; the second reads what the first stored", async () => {
    const locks = table();
    let stored: string | null = null;
    let downloads = 0;
    const download = async () => {
      downloads++;
      await sleep(80);
      stored = "meta";
      return stored;
    };
    const read = async () => stored;
    const [a, b] = await Promise.all([withDownloadLock(locks, "meta:1", read, download, opts), withDownloadLock(locks, "meta:1", read, download, opts)]);
    expect([a, b]).toEqual(["meta", "meta"]);
    expect(downloads).toBe(1);
  });

  it("returns what is stored without taking the lock", async () => {
    const locks = table();
    expect(await withDownloadLock(locks, "meta:1", async () => "meta", async () => "fresh", opts)).toBe("meta");
    expect(locks.claims).toBe(0);
  });

  it("takes over when the first download fails", async () => {
    const locks = table();
    let stored: string | null = null;
    let attempts = 0;
    const download = async () => {
      attempts++;
      await sleep(50);
      if (attempts === 1) throw new Error("OpenF1 timed out");
      stored = "meta";
      return stored;
    };
    const first = withDownloadLock(locks, "meta:1", async () => stored, download, opts);
    await sleep(5);
    const second = withDownloadLock(locks, "meta:1", async () => stored, download, opts);
    await expect(first).rejects.toThrow("OpenF1 timed out");
    expect(await second).toBe("meta");
    expect(attempts).toBe(2);
  });

  it("gives up waiting with a busy error instead of running past the function limit", async () => {
    const locks = table();
    await locks.claim("meta:1", "someone-else", 60);
    await expect(withDownloadLock(locks, "meta:1", async () => null, async () => "x", { ...opts, waitMs: 50 })).rejects.toBeInstanceOf(DownloadBusyError);
  });

  it("ignores an expired lock left by a crashed instance", async () => {
    const locks = table();
    await locks.claim("meta:1", "crashed", -1);
    expect(await withDownloadLock(locks, "meta:1", async () => null, async () => "meta", opts)).toBe("meta");
  });
});
