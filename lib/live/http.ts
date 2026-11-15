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
