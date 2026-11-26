import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const root = mkdtempSync(path.join(tmpdir(), "practice-store-"));
process.env.STORE_DIR = root;
delete process.env.SUPABASE_URL;

const { getStore, writeJson } = await import("@/lib/storage/store");
const { prunePractice } = await import("./practice-store");

const DAY = 86_400_000;
const now = Date.parse("2026-12-01T12:00:00Z");

/** Keeps a practice session with `windows` windows as if written `daysAgo` days before `now`. */
async function keep(session: number, windows: number, daysAgo: number) {
  const names = [`${session}-meta.json`, ...Array.from({ length: windows }, (_, i) => `${session}-chunk-${i}.json`)];
  for (const n of names) {
    await writeJson(`practice/${n}`, { session, filler: "x".repeat(2000) });
    const t = (now - daysAgo * DAY) / 1000;
    utimesSync(path.join(root, "practice", `${n}.gz`), t, t);
  }
}

describe("practice kept for a while", () => {
  it("clears a session a week after it was kept, and the oldest first above the cap", async () => {
    await keep(11001, 3, 8); // over a week: cleared
    await keep(11002, 3, 5);
    await keep(11003, 3, 2);
    await keep(11004, 3, 0);
    const files = await getStore().list("practice");
    const perSession = files.filter((f) => f.name.startsWith("11002-")).reduce((s, f) => s + f.bytes, 0);

    // Room for two sessions: 11001 goes for its age, then 11002 as the oldest left.
    const r = await prunePractice(now, perSession * 2 + 10);
    expect(r).toMatchObject({ kept: 2, removed: 2 });
    const left = new Set((await getStore().list("practice")).map((f) => f.name.split("-")[0]));
    expect([...left].sort()).toEqual(["11003", "11004"]);

    // Nothing more to do on the next run.
    expect(await prunePractice(now, perSession * 2 + 10)).toMatchObject({ kept: 2, removed: 0 });
  });
});
