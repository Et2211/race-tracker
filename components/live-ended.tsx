"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { NotLive } from "@/lib/live/not-live";
import { useNow } from "./home/use-now";

/** A time in the viewer's own time zone, with the day when it is not today. */
function when(ms: number, now: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return d.toLocaleString(undefined, sameDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "long", hour: "2-digit", minute: "2-digit" });
}

/**
 * A live link that cannot open live: before live timing opens, it waits and connects by itself;
 * after the session, it waits for the replay and goes there by itself.
 */
export function NotLivePanel({ why, sessionKey, onRetry }: { why: NotLive; sessionKey: number; onRetry: () => void }) {
  const router = useRouter();
  const now = useNow(10_000);
  const replayReady = why.code === "ended" && now !== null && now >= why.replayAt;
  useEffect(() => {
    // Timers past ~24 days overflow and fire at once: nothing is scheduled that far ahead.
    const later = (ms: number, run: () => void) => (ms < 2 ** 31 - 1 ? setTimeout(run, Math.max(0, ms)) : undefined);
    let id: ReturnType<typeof setTimeout> | undefined;
    if (why.code === "ended") id = later(why.replayAt - Date.now(), () => router.replace(`/session/${sessionKey}`));
    // A little after opening (the server keeps its answer for 30 s), and never in a tight loop.
    if (why.code === "upcoming") id = later(Math.max(15_000, why.opensAt - Date.now() + 5_000), onRetry);
    return () => clearTimeout(id);
  }, [why, router, sessionKey, onRetry]);

  if (why.code === "ended") {
    return (
      <>
        <h2>This session has ended</h2>
        <p className="note">{replayReady ? "Opening the replay…" : now !== null ? `The replay will be ready at ${when(why.replayAt, now)}. This page will open it then.` : ""}</p>
        <Link href="/" className="tab" style={{ alignSelf: "flex-start" }}>← All sessions</Link>
      </>
    );
  }
  if (why.code === "upcoming") {
    return (
      <>
        <h2>This session hasn&apos;t started yet</h2>
        <p className="note">{now !== null ? `Live timing opens at ${when(why.opensAt, now)}, 20 minutes before the start. This page will connect by itself.` : ""}</p>
        <Link href="/" className="tab" style={{ alignSelf: "flex-start" }}>← All sessions</Link>
      </>
    );
  }
  return (
    <>
      <h2>This session isn&apos;t live right now</h2>
      <Link href="/" className="tab" style={{ alignSelf: "flex-start" }}>← All sessions</Link>
    </>
  );
}

/** In place of the live status once the session is over: when the replay is ready, a link to it. */
export function FinishedLine({ sessionKey, replayAt }: { sessionKey: number; replayAt: number }) {
  const now = useNow(10_000);
  return (
    <div role="status" className="live-status off">
      <strong>Session finished</strong>
      {now !== null && (now >= replayAt ? (
        <Link href={`/session/${sessionKey}`} className="seg">Watch the replay →</Link>
      ) : (
        <span className="muted">Replay ready at {when(replayAt, now)}</span>
      ))}
    </div>
  );
}
