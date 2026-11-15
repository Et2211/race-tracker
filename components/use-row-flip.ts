"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** Longest jump in session time that still animates; larger jumps (scrubbing, jump to lap) just snap. */
const MAX_STEP_MS = 30_000;
const DURATION_MS = 450;

/**
 * Slide table rows to their new places when the order changes ("FLIP": measure where each row
 * was, let React move it, then animate it from the old place to the new one). Rows need a
 * `data-key`. Animates only for small forward steps of the replay and never with reduced motion.
 */
export function useRowFlip(body: RefObject<HTMLTableSectionElement | null>, order: string, t: number) {
  const tops = useRef(new Map<string, number>());
  const lastT = useRef<number | null>(null);

  useLayoutEffect(() => {
    const rows = body.current ? Array.from(body.current.querySelectorAll<HTMLTableRowElement>("tr[data-key]")) : [];
    const step = lastT.current === null ? Infinity : t - lastT.current;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = step > 0 && step <= MAX_STEP_MS && !reduced;
    const next = new Map<string, number>();
    for (const row of rows) {
      const key = row.dataset.key!;
      const top = row.offsetTop;
      next.set(key, top);
      const before = tops.current.get(key);
      if (animate && before !== undefined && before !== top && typeof row.animate === "function") {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], {
          duration: DURATION_MS,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    }
    tops.current = next;
    lastT.current = t;
    // Only a change of order matters; `t` is read for the step size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);
}
