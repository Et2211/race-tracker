"use client";

import { useLayoutEffect, type RefObject } from "react";

const DURATION_MS = 300;

/**
 * Grow or shrink `box` smoothly when the size of `content` (its only child) changes, instead of
 * jumping. The box keeps its natural `auto` height; only the move between two heights animates.
 * A change in the middle of an animation starts the next one from wherever the box is now.
 * Never animates with reduced motion. `box` should use `box-sizing: border-box`.
 */
export function useHeightTransition(box: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = box.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    let shown = el.getBoundingClientRect().height;
    let running: Animation | null = null;
    const observer = new ResizeObserver(() => {
      // Mid-animation the box is at the animated height, which is where the next one starts.
      const from = running ? el.getBoundingClientRect().height : shown;
      running?.cancel();
      running = null;
      const to = el.getBoundingClientRect().height;
      shown = to;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (Math.abs(to - from) < 1 || reduced || typeof el.animate !== "function") return;
      const anim = el.animate(
        [
          { height: `${from}px`, overflow: "hidden" },
          { height: `${to}px`, overflow: "hidden" },
        ],
        { duration: DURATION_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
      anim.onfinish = () => {
        if (running === anim) running = null;
      };
      running = anim;
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
      running?.cancel();
    };
  }, [box, content]);
}
