"use client";

import { useCallback, useEffect, useState } from "react";
import type { Speed } from "./use-clock";

/**
 * The clock for a live session: real time minus a delay, never past the newest data received.
 * Same shape as the replay clock, with the delay as the one setting:
 *  - `seek(t)` shows session time t from now on (sets the delay), e.g. syncing to a video stream
 *    or scrolling back;
 *  - pausing freezes the time shown, and playing again keeps it that far behind, so pausing the
 *    video and the dashboard together keeps them in step;
 *  - `toTarget()` returns to the synced delay (or to the newest data, without one).
 * `enabled` false makes it inert (the replay dashboard calls it too, to keep hooks unconditional).
 */
/** The newest seconds of car data are still arriving (each poll brings the last second): stay this far back. */
export const LIVE_EDGE_MS = 3000;

export function useLiveClock(newest: number | null, enabled: boolean) {
  const latest = newest === null ? null : newest - LIVE_EDGE_MS;
  const [now, setNow] = useState<number | null>(null);
  const [delay, setDelay] = useState(0);
  const [target, setTarget] = useState<number | null>(null); // the synced delay, if any
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const tick = () => {
      setNow(Date.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  const raw = pausedAt ?? (now === null ? (latest ?? 0) : now - delay);
  const t = latest !== null ? Math.min(raw, latest) : raw;

  const seek = useCallback(
    (to: number) => {
      if (pausedAt !== null) setPausedAt(to);
      else setDelay(Math.max(0, Date.now() - to));
    },
    [pausedAt],
  );
  const setPlaying = useCallback(
    (playing: boolean) => {
      if (!playing && pausedAt === null) setPausedAt(t);
      if (playing && pausedAt !== null) {
        setDelay(Math.max(0, Date.now() - pausedAt));
        setPausedAt(null);
      }
    },
    [pausedAt, t],
  );
  /** Remember the current delay as the one to come back to (after syncing to a stream). */
  const keepDelay = useCallback((to: number) => setTarget(Math.max(0, Date.now() - to)), []);
  const toTarget = useCallback(() => {
    setPausedAt(null);
    setDelay(target ?? 0);
  }, [target]);

  return {
    t,
    playing: pausedAt === null,
    setPlaying,
    speed: 1 as Speed,
    setSpeed: (() => {}) as (s: Speed) => void,
    seek,
    /** Milliseconds between the time shown and the newest data. */
    behind: latest !== null ? Math.max(0, latest - t) : 0,
    /** Milliseconds between the time shown and real time. */
    delay: now === null ? 0 : Math.max(0, now - t),
    synced: target !== null,
    keepDelay,
    toTarget,
  };
}
