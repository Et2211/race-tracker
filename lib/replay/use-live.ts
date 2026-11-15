"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveStatusView } from "@/lib/live/http";
import { mergeLiveRows, type LiveRow } from "@/lib/live/merge";
import { TelemetryIndex } from "@/lib/session/telemetry";
import type { SessionMeta, TelemetryChunk } from "@/lib/session/types";
import type { LoadState } from "./use-session";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

const POLL_MS = 1000;
const minuteOf = (ms: number) => Math.floor(ms / 60_000);

/**
 * A session while it runs: the metadata so far, then every second the rows that changed since
 * and the newest minute of car data. `playhead` (the time shown, when scrolled back) gets its
 * minute loaded too. Same shape as `useSession`, so the dashboard treats both alike.
 */
export function useLiveSession(sessionKey: number, playhead: number | null) {
  const [telemetry] = useState(() => new TelemetryIndex());
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [state, setState] = useState<LoadState>({ phase: "meta", message: "Connecting to the live session" });
  const [status, setStatus] = useState<LiveStatusView | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const statusRef = useRef<LiveStatusView | null>(null);
  const playheadRef = useRef<number | null>(playhead);
  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  // Metadata, then changes since its revision.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rev = 0;
    const poll = async () => {
      if (stopped) return;
      let soon = false;
      try {
        const u = await getJson<{ rows: LiveRow[]; rev: number; more: boolean; status: LiveStatusView }>(`/api/live/${sessionKey}/updates?rev=${rev}`);
        if (stopped) return;
        rev = u.rev;
        if (u.rows.length) setMeta((m) => (m ? mergeLiveRows(m, u.rows) : m));
        statusRef.current = u.status;
        setStatus(u.status);
        setFailed(null);
        soon = u.more;
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      }
      timer = setTimeout(poll, soon ? 0 : POLL_MS);
    };
    (async () => {
      try {
        const first = await getJson<{ meta: SessionMeta; rev: number; status: LiveStatusView }>(`/api/live/${sessionKey}`);
        if (stopped) return;
        rev = first.rev;
        statusRef.current = first.status;
        setMeta(first.meta);
        setStatus(first.status);
        setState({ phase: "ready" });
        timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (!stopped) setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionKey, attempt]);

  // Car data, a minute at a time: the newest minute (and the one before, until it is complete),
  // and the playhead's minute when scrolled back.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Minutes whose data is complete: the feed had moved past them when they were fetched.
    const done = new Set<number>();
    const tick = async () => {
      if (stopped) return;
      const s = statusRef.current;
      if (s?.lastSecond !== null && s?.lastSecond !== undefined) {
        const newest = minuteOf((s.lastSecond + 1) * 1000);
        const wanted = new Set([newest, newest - 1]);
        const p = playheadRef.current;
        if (p !== null) for (const m of [minuteOf(p) - 1, minuteOf(p), minuteOf(p) + 1]) if (m <= newest) wanted.add(m);
        for (const m of [...wanted].sort((a, b) => b - a)) {
          if (done.has(m) || (s.firstSecond !== null && (m + 1) * 60 <= s.firstSecond)) continue;
          try {
            const chunk = await getJson<TelemetryChunk>(`/api/live/${sessionKey}/telemetry?minute=${m}`);
            if (stopped) return;
            if (chunk.to > chunk.from) {
              telemetry.add(chunk);
              setVersion((v) => v + 1);
            }
            if (m < newest - 1 || chunk.to >= (m + 1) * 60_000) done.add(m);
          } catch (e) {
            setFailed(e instanceof Error ? e.message : String(e));
            break;
          }
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionKey, telemetry, attempt]);

  const retry = useCallback(() => {
    setState({ phase: "meta", message: "Connecting to the live session" });
    setAttempt((a) => a + 1);
  }, []);
  const minutes = telemetry.ranges().reduce((n, [a, b]) => n + Math.round((b - a) / 60_000), 0);

  return {
    meta,
    state,
    retry,
    telemetry,
    version,
    progress: { ready: minutes, total: minutes, failed: failed ? 1 : 0, error: failed },
    retryChunks: retry,
    live: { status },
  };
}
