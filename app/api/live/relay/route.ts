import { after, connection } from "next/server";
import { runRelay } from "@/lib/live/relay";
import { liveStore } from "@/lib/live/store";
import { openf1Credentials } from "@/lib/openf1/auth";
import { cronAuthorized } from "@/lib/session/cron-auth";

export const maxDuration = 300;

/** Each relay holds its connection this long; started every minute, two or three overlap. */
const RELAY_MS = Number(process.env.LIVE_RELAY_SECONDS ?? 150) * 1000;

/**
 * Called every minute by the database job while a session is on (`live_session_now()`), or by
 * hand with `?session=<key>`. Answers at once and keeps the connection open after the response,
 * so it does not matter when the caller stops waiting. Does nothing without OpenF1 credentials.
 */
export async function GET(req: Request) {
  await connection();
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!openf1Credentials()) return Response.json({ skipped: "OpenF1 credentials are not set" });
  const store = liveStore();
  const forced = Number(new URL(req.url).searchParams.get("session"));
  const sessionKey = Number.isInteger(forced) && forced > 0 ? forced : (await store.sessionNow())?.session_key;
  if (!sessionKey) return Response.json({ skipped: "No session is on" });
  after(async () => {
    const report = await runRelay({ sessionKey, durationMs: RELAY_MS, store, log: (line) => console.info(`[live ${sessionKey}] ${line}`) }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    console.info(`[live ${sessionKey}] relay finished`, JSON.stringify(report));
  });
  return Response.json({ started: sessionKey, seconds: RELAY_MS / 1000 }, { status: 202 });
}
