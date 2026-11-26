"use client";

import { useEffect, useRef, type PointerEvent } from "react";

type Move = (e: PointerEvent<SVGRectElement>) => void;

/**
 * Pointer handling for a chart's invisible hit area, for a mouse and a finger alike:
 *  - a mouse shows the point under it, and clears when it leaves;
 *  - a finger shows the point it taps or drags across (where the page lets it drag, see
 *    `.chart-hit`), and leaves it showing after it lifts, since there is no hovering on a phone;
 *    touching anywhere else clears it.
 * Call it with whether a point is showing and how to hide it, then spread `props(onPoint)` on the
 * hit area, with `onPoint` picking the point from the event.
 */
export function useChartPointer(active: boolean, onClear: () => void) {
  const hit = useRef<SVGRectElement>(null);
  const clear = useRef(onClear);
  useEffect(() => {
    clear.current = onClear;
  }, [onClear]);

  useEffect(() => {
    if (!active) return;
    const away = (e: globalThis.PointerEvent) => {
      if (e.target !== hit.current) clear.current();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [active]);

  return {
    props: (onPoint: Move) => ({
      ref: hit,
      className: "chart-hit",
      onPointerMove: onPoint,
      // A tap is a pointerup without a pointercancel: a touch that starts a scroll is not one.
      onPointerUp: (e: PointerEvent<SVGRectElement>) => {
        if (e.pointerType === "touch") onPoint(e);
      },
      onPointerLeave: (e: PointerEvent<SVGRectElement>) => {
        if (e.pointerType !== "touch") onClear();
      },
    }),
  };
}
