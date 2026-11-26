import "server-only";
import { getStore } from "@/lib/storage/store";

/**
 * Practice replays are kept for a while rather than for good (the owner's call: practice isn't
 * worth permanent space). The first viewer's download is written to `practice/`; everyone after
 * that, on any server, reads it instead of asking OpenF1 again. The daily job clears a session a
 * week after it was kept, and the oldest first if the folder grows past PRACTICE_CAP_MB. A
 * session opened again after that is simply downloaded and kept again.
 */
export const PRACTICE_KEEP_DAYS = 7;
const CAP_BYTES = Number(process.env.PRACTICE_CAP_MB ?? 150) * 1024 * 1024;
const FOLDER = "practice";

export type PracticePrune = { kept: number; removed: number; bytes: number };

/** One pass of the rule above; `now` for tests. */
export async function prunePractice(now = Date.now(), capBytes = CAP_BYTES): Promise<PracticePrune> {
  const store = getStore();
  const files = await store.list(FOLDER);
  // Files are "<session>-meta.json" and "<session>-chunk-<n>.json"; a session counts from its first file.
  const sessions = new Map<string, { keys: string[]; bytes: number; since: number }>();
  for (const f of files) {
    const session = f.name.split("-")[0];
    const s = sessions.get(session) ?? { keys: [], bytes: 0, since: Infinity };
    s.keys.push(`${FOLDER}/${f.name}`);
    s.bytes += f.bytes;
    s.since = Math.min(s.since, f.at);
    sessions.set(session, s);
  }
  const oldestFirst = [...sessions.values()].sort((a, b) => a.since - b.since);
  const expired = oldestFirst.filter((s) => now - s.since > PRACTICE_KEEP_DAYS * 86_400_000);
  let bytes = oldestFirst.reduce((sum, s) => sum + s.bytes, 0) - expired.reduce((sum, s) => sum + s.bytes, 0);
  const drop = [...expired];
  for (const s of oldestFirst) {
    if (bytes <= capBytes) break;
    if (drop.includes(s)) continue;
    drop.push(s);
    bytes -= s.bytes;
  }
  if (drop.length) await store.remove(drop.flatMap((s) => s.keys));
  return { kept: sessions.size - drop.length, removed: drop.length, bytes };
}
