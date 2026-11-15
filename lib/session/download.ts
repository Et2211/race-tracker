import "server-only";
import { ingestMeta, ingestWindow } from "./ingest";

export type DownloadResult = { sessionKey: number; windows: number; stored: number; complete: boolean; seconds: number };

/**
 * Download a whole session into the store on the server: metadata, then every telemetry window.
 * Stops starting new windows once `budgetMs` has passed, so a run always ends inside the
 * function's time limit; already-stored parts are skipped, so the next run carries on.
 */
export async function downloadSession(sessionKey: number, budgetMs: number): Promise<DownloadResult> {
  const started = Date.now();
  const meta = await ingestMeta(sessionKey);
  let stored = 0;
  for (const w of meta.windows) {
    if (Date.now() - started > budgetMs) break;
    await ingestWindow(meta, w.index);
    stored++;
  }
  return { sessionKey, windows: meta.windows.length, stored, complete: stored === meta.windows.length, seconds: Math.round((Date.now() - started) / 1000) };
}
