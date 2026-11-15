"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const SPEEDS = [1, 2, 4, 8, 16] as const;
export type Speed = (typeof SPEEDS)[number];

const NO_SKIPS: [number, number][] = [];

/**
 * Replay clock. `t` is session time in epoch ms. While playing it advances by real elapsed time
 * times `speed`, jumps over any `skips` stretch it runs into (breaks with nothing on track), and
 * stops at the end of the span. Playing from the end starts again from the beginning.
 */
export function useClock(span: { start: number; end: number }, initial: number | null, skips: [number, number][] = NO_SKIPS) {
  const [t, setT] = useState<number>(() => Math.min(span.end, Math.max(span.start, initial ?? span.start)));
  const [playing, setPlayingState] = useState(false);
  const [speed, setSpeed] = useState<Speed>(4);
  // The current time for the animation loop and handlers, which must not wait for a render.
  const now = useRef(t);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (wall: number) => {
      const elapsed = last === null ? 0 : wall - last;
      last = wall;
      let next = now.current + elapsed * speed;
      const skip = skips.find(([a, b]) => next >= a && next < b);
      if (skip) next = skip[1];
      if (next >= span.end) {
        now.current = span.end;
        setT(span.end);
        setPlayingState(false);
        return;
      }
      now.current = next;
      setT(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, span, skips]);

  const seek = useCallback(
    (to: number) => {
      const v = Math.min(span.end, Math.max(span.start, to));
      now.current = v;
      setT(v);
    },
    [span],
  );
  const setPlaying = useCallback(
    (p: boolean) => {
      if (p && now.current >= span.end) {
        now.current = span.start;
        setT(span.start);
      }
      setPlayingState(p);
    },
    [span],
  );
  return { t, playing, setPlaying, speed, setSpeed, seek };
}

/** A value that follows `value` but updates at most every `ms` milliseconds of real time. */
export function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const lastAt = useRef(0);
  useEffect(() => {
    const now = performance.now();
    const wait = lastAt.current + ms - now;
    if (wait <= 0) {
      lastAt.current = now;
      setOut(value);
      return;
    }
    const id = setTimeout(() => {
      lastAt.current = performance.now();
      setOut(value);
    }, wait);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}
