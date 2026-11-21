"use client";

import Link from "next/link";
import { useNow } from "@/components/home/use-now";
import type { Session } from "@/lib/openf1/types";
import type { PracticeClock, QualifyingClock } from "@/lib/timing/session-clock";

const two = (n: number) => String(n).padStart(2, "0");
/** m:ss, or h:mm:ss from an hour up, rounded up as session clocks are. */
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
};

function ClockPill({ text, tone }: { text: string; tone: string }) {
  return (
    <span className={`pill session-clock ${tone}`} role="timer" aria-label={`Session clock: ${text}`}>
      {text}
    </span>
  );
}

/** The qualifying clock, as the TV graphic shows it: time left in the phase, or the break. */
export function QualifyingClockPill({ clock, prefix, live, t }: { clock: QualifyingClock; prefix: string; live: boolean; t: number }) {
  let text: string;
  let tone = "";
  switch (clock.state) {
    case "before":
      text = clock.startsAt !== null && !live ? `${prefix}1 starts in ${mmss(clock.startsAt - t)}` : `Before ${prefix}1`;
      break;
    case "running":
      text = `${prefix}${clock.phase} · ${mmss(clock.remainingMs)} left`;
      tone = "on";
      break;
    case "stopped":
      text = `${prefix}${clock.phase} · clock stopped · ${mmss(clock.remainingMs)} left`;
      tone = "stopped";
      break;
    case "break":
      // A replay knows when the next phase started; live, it is announced in race control.
      text = clock.startsAt !== null && !live ? `${prefix}${clock.finished} over · ${prefix}${clock.next} starts in ${mmss(clock.startsAt - t)}` : `${prefix}${clock.finished} over · ${prefix}${clock.next} next`;
      break;
    case "over":
      text = "Qualifying over";
  }
  return <ClockPill text={text} tone={tone} />;
}

/** The practice clock: time left in the session, which keeps running under a red flag. */
export function PracticeClockPill({ clock, name, live, t }: { clock: PracticeClock; name: string; live: boolean; t: number }) {
  const short = name.replace(/^Practice (\d)$/, "FP$1");
  let text: string;
  let tone = "";
  switch (clock.state) {
    case "before":
      // A replay knows when it started; live, a delay is only announced in race control.
      text = clock.startsAt !== null && !live ? `${short} starts in ${mmss(clock.startsAt - t)}` : `Before ${short}`;
      break;
    case "running":
      text = `${short} · ${mmss(clock.remainingMs)} left`;
      tone = "on";
      break;
    case "red":
      text = `${short} · red flag · ${mmss(clock.remainingMs)} left`;
      tone = "stopped";
      break;
    case "overrun":
      text = `${short} · running past its scheduled end`;
      tone = "on";
      break;
    case "over":
      text = `${short} over`;
  }
  return <ClockPill text={text} tone={tone} />;
}

/** Shown on a replay while the session is actually on: from 20 minutes before to 30 minutes after. */
export function WatchLiveButton({ session }: { session: Pick<Session, "session_key" | "date_start" | "date_end"> }) {
  const now = useNow(30_000);
  if (now === null) return null;
  const on = now >= Date.parse(session.date_start) - 20 * 60_000 && now < Date.parse(session.date_end) + 30 * 60_000;
  if (!on) return null;
  return (
    <Link href={`/live/${session.session_key}`} className="pill live-pill watch-live">
      <span className="live-dot" aria-hidden="true" /> Watch live
    </Link>
  );
}
