import "server-only";
import { openf1Credentials } from "@/lib/openf1/auth";
import { liveStore, type LiveStatus } from "./store";

export type LiveStatusView = LiveStatus & { configured: boolean; now: number };

/** Live endpoints: the session key from the URL, and the store; 404 for anything that is not a key. */
export async function liveContext(params: Promise<{ key: string }>) {
  const sessionKey = Number((await params).key);
  if (!Number.isInteger(sessionKey) || sessionKey <= 0) return null;
  return { sessionKey, store: liveStore() };
}

export async function statusView(sessionKey: number): Promise<LiveStatusView> {
  return { ...(await liveStore().status(sessionKey)), configured: openf1Credentials() !== null, now: Date.now() };
}

/** Live data changes every second: never cache it. */
export const noStore = { "Cache-Control": "no-store" };

/**
 * Whether a live session may be opened: the session on now (from the calendar), or one relays
 * have already written. Anything else would make the server call OpenF1 on the paid account for
 * an arbitrary number. Answers are kept for 30 s.
 */
const allowed = new Map<number, { at: number; ok: boolean }>();
export async function liveAllowed(sessionKey: number): Promise<boolean> {
  const hit = allowed.get(sessionKey);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  const store = liveStore();
  const [now, status] = await Promise.all([store.sessionNow().catch(() => null), store.status(sessionKey)]);
  const ok = now?.session_key === sessionKey || status.lastRev > 0 || status.lastSecond !== null;
  allowed.set(sessionKey, { at: Date.now(), ok });
  return ok;
}
