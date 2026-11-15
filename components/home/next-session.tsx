"use client";

import Link from "next/link";
import type { HomeData } from "@/lib/home/data";
import { pickNext } from "@/lib/home/next";
import { SHAPE_VIEWBOX } from "@/lib/session/summary";
import { useNow } from "./use-now";

const two = (n: number) => String(n).padStart(2, "0");

/**
 * The next session with a countdown, in the viewer's time zone. The page may be a few minutes
 * old (it is cached), so the next session is picked again here, against the viewer's clock: one
 * that has ended moves on to the following one rather than counting down to zero.
 */
export function NextSession({ next: initial, meetings }: { next: NonNullable<HomeData["next"]>; meetings: HomeData["meetings"] }) {
  const now = useNow();
  const next = now === null ? initial : pickNext(meetings, now);
  if (!next) {
    return (
      <section className="panel hero" aria-labelledby="next-title">
        <div className="hero-copy">
          <div className="hd" style={{ color: "var(--red-text)" }}>Season complete</div>
          <h2 id="next-title" className="hero-title">That&apos;s the season</h2>
          <p className="hero-sub">Every session is in the calendar below.</p>
        </div>
      </section>
    );
  }
  const { meeting, session } = next;
  const start = Date.parse(session.dateStart);
  const end = Date.parse(session.dateEnd);
  const live = now !== null && now >= start && now < end;
  // The live view has data from 20 minutes before the start (the relays start then).
  const watchable = now !== null && now >= start - 20 * 60_000 && now < end + 30 * 60_000;
  const left = now === null ? null : Math.max(0, start - now);
  const parts = left === null ? null : { d: Math.floor(left / 86_400_000), h: Math.floor(left / 3_600_000) % 24, m: Math.floor(left / 60_000) % 60, s: Math.floor(left / 1000) % 60 };
  const when =
    now === null
      ? new Date(start).toUTCString().replace(":00 GMT", " UTC").slice(0, -4)
      : new Date(start).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  return (
    <section className="panel hero" aria-labelledby="next-title">
      <div className="hero-copy">
        <div className="hd" style={{ color: "var(--red-text)" }}>{live ? "On track now" : "Next session"}{meeting.round ? ` · Round ${meeting.round}` : ""}</div>
        <h2 id="next-title" className="hero-title">{meeting.name}</h2>
        <p className="hero-sub">{session.name} · {meeting.circuit}</p>
        <p className="muted" style={{ margin: 0 }}>{when}</p>
        {watchable && (
          <Link href={`/live/${session.sessionKey}`} className="cta">
            <span className="live-dot" aria-hidden="true" /> Watch live
          </Link>
        )}
        {live ? (
          <p className="note" style={{ marginTop: 8 }}>The full replay is downloaded automatically about three hours after the session ends.</p>
        ) : (
          <div className="countdown" role="timer" aria-label={parts ? `${parts.d} days ${parts.h} hours ${parts.m} minutes to go` : "Countdown"}>
            {(["d", "h", "m", "s"] as const).map((k) => (
              <div key={k} className="countdown-cell">
                <span className="countdown-num">{parts ? (k === "d" ? parts[k] : two(parts[k])) : "–"}</span>
                <span className="countdown-unit">{{ d: "days", h: "hours", m: "min", s: "sec" }[k]}</span>
              </div>
            ))}
          </div>
        )}
        <div className="chip-row">
          {meeting.sessions.map((s) => (
            <span key={s.sessionKey} className={`chip-session ${s.sessionKey === session.sessionKey ? "on" : ""}`}>{s.name}</span>
          ))}
        </div>
      </div>
      {meeting.shape && (
        <figure className="hero-figure">
          <svg className="hero-track" viewBox={SHAPE_VIEWBOX} role="img" aria-label={`Outline of ${meeting.circuit}`}>
            <path d={meeting.shape.path} className="track-glow" />
            <path d={meeting.shape.path} className="track-line" />
            <circle cx={meeting.shape.startX} cy={meeting.shape.startY} r={9} className="track-start" />
          </svg>
          {meeting.shape.year < new Date(meeting.dateStart).getUTCFullYear() && <figcaption className="layout-note">{meeting.shape.year} layout</figcaption>}
        </figure>
      )}
      {!meeting.shape && <p className="note" style={{ alignSelf: "end" }}>New circuit: its outline is drawn after the first session here.</p>}
    </section>
  );
}

