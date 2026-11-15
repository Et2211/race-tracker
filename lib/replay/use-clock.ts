"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const SPEEDS = [1, 2, 4, 8, 16] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Replay clock. `t` is session time in epoch ms. While playing it advances by real elapsed time
 * times `speed`, and stops at the end of the span.
 */
export function useClock(span: { start: number; end: number }, initial: number | null) {
  const [t, setT] = useState<number>(() => Math.min(span.end, Math.max(span.start, initial ?? span.start)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(4);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (now: number) => {
      const prev = last.current ?? now;
      last.current = now;
      setT((current) => {
        const next = current + (now - prev) * speed;
        if (next >= span.end) {
          setPlaying(false);
          return span.end;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      last.current = null;
    };
  }, [playing, speed, span]);

  const seek = useCallback((to: number) => setT(Math.min(span.end, Math.max(span.start, to))), [span]);
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
