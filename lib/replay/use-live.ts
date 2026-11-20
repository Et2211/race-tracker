"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveStatusView } from "@/lib/live/http";
import type { NotLive } from "@/lib/live/not-live";
import { mergeLiveRows, type LiveRow } from "@/lib/live/merge";
import { TelemetryIndex } from "@/lib/session/telemetry";
import type { SessionMeta, TelemetryChunk } from "@/lib/session/types";
import type { LoadState } from "./use-session";

/** An error response, with its body (the reason a session is not live, for one). */
class HttpError extends Error {
  constructor(message: string, readonly body: Record<string, unknown> | null) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(body?.error ?? `HTTP ${res.status}`, body);
  return body as T;
}

const NOT_LIVE_CODES = new Set(["upcoming", "ended", "not-live"]);
const notLiveOf = (e: unknown): NotLive | undefined =>
  e instanceof HttpError && NOT_LIVE_CODES.has(String(e.body?.code)) ? (e.body as unknown as NotLive) : undefined;

const POLL_MS = 1000;
/** Seconds of car data loaded on opening, and per step when scrolling back. */
const OPEN_S = 120;

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
      if (document.hidden) {
        timer = setTimeout(poll, POLL_MS);
        return;
      }
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
        if (!stopped) setState({ phase: "error", message: e instanceof Error ? e.message : String(e), notLive: notLiveOf(e) });
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionKey, attempt]);

  // Car data, a second at a time. On opening: the last two minutes. Then every second, whatever
  // was written or improved since the revision already read (new seconds, gaps filled later,
  // partial seconds replaced). Scrolling back loads earlier seconds two minutes at a time.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor: number | null = null;
    let loadedFrom: number | null = null;
    const add = (chunks: TelemetryChunk[]) => {
      if (chunks.length === 0) return;
      telemetry.addMany(chunks);
      setVersion((v) => v + 1);
    };
    const tick = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(tick, POLL_MS); // nothing to draw: wait until the tab is visible again
        return;
      }
      const s = statusRef.current;
      try {
        if (cursor === null) {
          if (s?.lastSecond !== null && s?.lastSecond !== undefined) {
            const to = s.lastSecond + 1;
            const from = Math.max(s.firstSecond ?? to - OPEN_S, to - OPEN_S);
            const startRev = s.lastBucketRev; // anything written after this status arrives through the cursor
            const r = await getJson<{ chunks: TelemetryChunk[] }>(`/api/live/${sessionKey}/telemetry?from=${from}&to=${to}`);
            if (stopped) return;
            add(r.chunks);
            cursor = startRev;
            loadedFrom = from;
          }
        } else {
          for (let more = true; more && !stopped; ) {
            const r: { chunks: TelemetryChunk[]; rev: number; more: boolean } = await getJson(`/api/live/${sessionKey}/telemetry?rev=${cursor}`);
            if (stopped) return;
            add(r.chunks);
            cursor = r.rev;
            more = r.more;
          }
          const p = playheadRef.current;
          const first = s?.firstSecond ?? null;
          if (p !== null && loadedFrom !== null && first !== null && loadedFrom > first && p < (loadedFrom + 60) * 1000) {
            const to: number = loadedFrom;
            const from = Math.max(first, to - OPEN_S);
            const r = await getJson<{ chunks: TelemetryChunk[] }>(`/api/live/${sessionKey}/telemetry?from=${from}&to=${to}`);
            if (stopped) return;
            add(r.chunks);
            loadedFrom = from;
          }
        }
        setFailed(null);
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      }
      timer = setTimeout(tick, POLL_MS);
    };
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      timer = setTimeout(tick, 0);
    };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
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
