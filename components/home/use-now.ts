"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, ticking every `ms`. Null during server rendering and hydration, so times
 * shown in the viewer's own time zone never mismatch the server's HTML.
 */
export function useNow(ms = 1000): number | null {
  return useSyncExternalStore(
    (notify) => {
      const id = setInterval(notify, ms);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / ms) * ms,
    () => null,
  );
}
