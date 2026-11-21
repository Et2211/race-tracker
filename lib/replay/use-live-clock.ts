"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Speed } from "./use-clock";

/** The newest seconds of car data are still arriving (each poll brings the last second): stay this far back. */
export const LIVE_EDGE_MS = 3000;
/**
 * The clock keeps its time between these two margins behind the newest data it knows of. The data
 * arrives in whole seconds, once per poll (a second plus the request), so what the clock knows of
 * can be two or three seconds stale between polls: a smaller margin lets the clock overtake it.
 */
const MARGIN_LOW_MS = 1500;
const MARGIN_HIGH_MS = 3000;
/** How much faster or slower than real time the clock runs to get back inside the margins. */
const SLEW = 0.2;

/** How long to wait for fresh data after the tab comes back before trusting what there is. */
const RESUME_WAIT_MS = 10_000;

/**
 * The time a live clock shows: real time minus the delay, never past the newest data received.
 * Pure, for testing; `useLiveClock` holds the state.
 */
export function liveTime(now: number, delay: number, latest: number | null, pausedAt: number | null): number {
  const raw = pausedAt ?? now - delay;
  return latest !== null ? Math.min(raw, latest) : raw;
}

/**
 * The delay to use from now on, `elapsed` ms after the last frame. The time shown stays between
 * MARGIN_LOW_MS and MARGIN_HIGH_MS behind the newest data, and is never moved backwards to get
 * there (a rewind shows as every car jumping back); instead the clock runs a little slow or fast:
 *  - slower (more delay) if it is closer to the data than the low margin, and stands still at the
 *    data if it has overtaken it, until more arrives;
 *  - faster (less delay) if it is further behind than the high margin and than `goal` (0 while
 *    following live, the synced delay while synced to a stream);
 *  - placed in the middle of the margins at once only on opening (no delay yet, and past the data);
 *  - otherwise unchanged (`goal` null: scrolled back or resumed after a pause, the viewer chose it).
 */
export function smoothedDelay(now: number, delay: number, latest: number | null, elapsed = 0, goal: number | null = null): number {
  if (latest === null) return delay;
  if (delay === 0 && now > latest) return now - latest + (MARGIN_LOW_MS + MARGIN_HIGH_MS) / 2; // opening
  const lowDelay = now - latest + MARGIN_LOW_MS; // the smallest delay that keeps the low margin
  if (delay < lowDelay) return delay + Math.min(lowDelay - delay, elapsed * SLEW);
  if (goal !== null) {
    const excess = delay - Math.max(goal, now - latest + MARGIN_HIGH_MS);
    if (excess > 250) return delay - Math.min(excess, elapsed * SLEW);
  }
  return delay;
}

/**
 * The clock for a live session: real time minus a delay, never past the newest data received.
 * Same shape as the replay clock, with the delay as the one setting:
 *  - `syncTo(t)` shows session time t now and keeps that delay (syncing to a video stream);
 *  - `seek(t)` scrolls to t (a delay to come back from with `toTarget()`);
 *  - pausing freezes the time shown, and playing again keeps it that far behind, so pausing the
 *    video and the dashboard together keeps them in step.
 * `enabled` false makes it inert (the replay dashboard calls it too, to keep hooks unconditional).
 */
export function useLiveClock(newest: number | null, enabled: boolean) {
  const latest = newest === null ? null : newest - LIVE_EDGE_MS;
  const [now, setNow] = useState<number | null>(null);
  const [delay, setDelay] = useState(0);
  const [target, setTarget] = useState<number | null>(null); // the synced delay, if any
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  // Following the newest data (not synced to a stream, not scrolled back, not resumed after a pause).
  const [following, setFollowing] = useState(true);
  // Holding the synced delay (synced to a stream and not scrolled away since).
  const [holding, setHolding] = useState(false);
  // The delay the clock works its way back to after falling behind; null: none, stay where it is.
  const goal = following ? 0 : holding ? target : null;
  const latestRef = useRef(latest);
  const goalRef = useRef(goal);
  useEffect(() => {
    latestRef.current = latest;
    goalRef.current = goal;
  }, [latest, goal]);

  // Every frame while running; nothing to animate while paused. While the tab is hidden, frames
  // stop and so does polling: coming back, the data on hand is minutes old until the next poll.
  // The delay is left alone until fresh data arrives, or the clock would take the time away as
  // the feed falling behind and add it to the delay (then crawl back at 1.5x, or never).
  useEffect(() => {
    if (!enabled || pausedAt !== null) return;
    let frame = 0;
    let last = Date.now();
    let resumed: { at: number; latest: number | null } | null = null;
    const onVisible = () => {
      if (!document.hidden) resumed = { at: Date.now(), latest: latestRef.current };
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = () => {
      const wall = Date.now();
      const elapsed = wall - last;
      last = wall;
      setNow(wall);
      const latest = latestRef.current;
      if (resumed !== null && latest === resumed.latest && wall - resumed.at < RESUME_WAIT_MS) {
        frame = requestAnimationFrame(tick); // still waiting for the data missed while away
        return;
      }
      resumed = null;
      setDelay((d) => smoothedDelay(wall, d, latest, elapsed, goalRef.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, pausedAt]);

  const t = now === null ? (pausedAt ?? latest ?? 0) : liveTime(now, delay, latest, pausedAt);

  const seek = useCallback(
    (to: number) => {
      setFollowing(false);
      setHolding(false);
      if (pausedAt !== null) setPausedAt(to);
      else setDelay(Math.max(0, Date.now() - to));
    },
    [pausedAt],
  );
  const setPlaying = useCallback(
    (playing: boolean) => {
      if (!playing && pausedAt === null) setPausedAt(t);
      if (playing && pausedAt !== null) {
        // Resume as far behind as the pause left it: never race to catch up (a video paused
        // alongside would fall out of step). Synced, the new delay becomes the one to hold.
        const d = Math.max(0, Date.now() - pausedAt);
        setDelay(d);
        setPausedAt(null);
        setFollowing(false);
        if (holding) setTarget(d);
      }
    },
    [pausedAt, t, holding],
  );
  /** Show session time `to` now, running, and remember the delay to come back to. */
  const syncTo = useCallback((to: number) => {
    const d = Math.max(0, Date.now() - to);
    setFollowing(false);
    setHolding(true);
    setPausedAt(null);
    setDelay(d);
    setTarget(d);
  }, []);
  /** Move the time shown by `ms` (positive: later), and the synced delay with it. */
  const nudge = useCallback(
    (ms: number) => {
      if (pausedAt !== null) setPausedAt(pausedAt + ms);
      setDelay((d) => Math.max(0, d - ms));
      setTarget((d) => (d === null ? d : Math.max(0, d - ms)));
    },
    [pausedAt],
  );
  const toTarget = useCallback(() => {
    setPausedAt(null);
    setDelay(target ?? 0);
    setFollowing(target === null);
    setHolding(target !== null);
  }, [target]);

  return {
    t,
    playing: pausedAt === null,
    setPlaying,
    speed: 1 as Speed,
    setSpeed: (() => {}) as (s: Speed) => void,
    seek,
    syncTo,
    nudge,
    /** Milliseconds between the time shown and the newest data. */
    behind: latest !== null ? Math.max(0, latest - t) : 0,
    synced: target !== null,
    /** True while following the newest data (nothing to come back to). */
    following: following && pausedAt === null,
    toTarget,
  };
}
