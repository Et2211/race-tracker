import "server-only";
import { liveStore } from "@/lib/live/store";
import { sessionIndex } from "@/lib/storage/session-index";
import { getStore } from "@/lib/storage/store";
import { ingestMeta, ingestWindow } from "./ingest";

export type DownloadResult = { sessionKey: number; windows: number; stored: number; complete: boolean; seconds: number };

/** A window takes up to ~90 s (two OpenF1 requests, split if too big, retried on 429): don't start one later than this. */
const WINDOW_MARGIN_MS = 90_000;

/**
 * Download a whole session into the store on the server: metadata, then every telemetry window
 * not stored yet (found by listing the session's files, not by downloading them). Stops starting
 * windows once less than WINDOW_MARGIN_MS of `budgetMs` is left, so a run ends inside the
 * function's time limit and the next run carries on. When every window is there, the session's
 * counts are set from the listing, so a counter that missed an update cannot leave the session
 * looking incomplete (and downloaded again every half hour).
 */
export async function downloadSession(sessionKey: number, budgetMs: number): Promise<DownloadResult> {
  const started = Date.now();
  const meta = await ingestMeta(sessionKey);
  const present = async () => {
    const files = await getStore().list(`sessions/${sessionKey}`);
    return { files, chunks: new Set(files.flatMap((f) => (/^chunk-(\d+)\.json$/.exec(f.name) ? [Number(/^chunk-(\d+)/.exec(f.name)![1])] : []))) };
  };
  const { chunks } = await present();
  for (const w of meta.windows) {
    if (chunks.has(w.index)) continue;
    if (Date.now() - started > budgetMs - WINDOW_MARGIN_MS) break;
    await ingestWindow(meta, w.index);
    chunks.add(w.index);
  }
  const stored = meta.windows.filter((w) => chunks.has(w.index)).length;
  const complete = stored === meta.windows.length;
  if (complete) {
    const listing = await present();
    await sessionIndex().reconcile(sessionKey, {
      windows: meta.windows.length,
      windowsStored: meta.windows.filter((w) => listing.chunks.has(w.index)).length,
      bytes: listing.files.reduce((sum, f) => sum + f.bytes, 0),
    });
  }
  // The final data is stored: the copy kept from the live feed is no longer needed.
  if (complete) await liveStore().clear(sessionKey).catch((e: unknown) => console.warn(`[live ${sessionKey}] could not clear live data`, e));
  return { sessionKey, windows: meta.windows.length, stored, complete, seconds: Math.round((Date.now() - started) / 1000) };
}
