"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveStatusView } from "@/lib/live/http";
import type { NotLive } from "@/lib/live/not-live";
import { mergeLiveRows } from "@/lib/live/merge";
import { planTick, type Cursors, type Tick } from "@/lib/live/sync";
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

/**
 * How often the shared tick is asked for. Every request counts against the host's monthly
 * allowance whether the CDN or the server answers it, so this is the main cost of each viewer;
 * the tick holds ten seconds of changes, so a viewer that misses one or two loses nothing.
 */
export const POLL_MS = 2000;
/** After a failed request, wait this long before the next, doubling up to the maximum. */
const RETRY_MS = 2000;
const RETRY_MAX_MS = 16_000;
/** Seconds of car data loaded on opening, and per step when scrolling back. */
const OPEN_S = 120;

/**
 * A session while it runs: the metadata so far and the last two minutes of car data, then every
 * two seconds the shared tick (lib/live/sync.ts) with whatever changed since. `playhead` (the
 * time shown, when scrolled back) gets its minute loaded too. Same shape as `useSession`, so the
 * dashboard treats both alike.
 */
export function useLiveSession(sessionKey: number, playhead: number | null) {
  const [telemetry] = useState(() => new TelemetryIndex());
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [state, setState] = useState<LoadState>({ phase: "meta", message: "Connecting to the live session" });
  const [status, setStatus] = useState<LiveStatusView | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const playheadRef = useRef<number | null>(playhead);
  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursors: Cursors | null = null;
    let firstSecond: number | null = null;
    let loadedFrom: number | null = null;
    let wait = RETRY_MS;
    const add = (chunks: TelemetryChunk[]) => {
      if (chunks.length === 0) return;
      telemetry.addMany(chunks);
      setVersion((v) => v + 1);
    };
    const showStatus = (s: LiveStatusView) => {
      firstSecond = s.firstSecond;
      setStatus(s);
    };

    /** The metadata and the last two minutes of car data; the tick brings both up to date. */
    const open = async () => {
      const first = await getJson<{ meta: SessionMeta; rev: number; status: LiveStatusView }>(`/api/live/${sessionKey}`);
      if (stopped) return;
      let bucketRev = first.status.lastBucketRev; // seconds written after this come through the tick
      const last = first.status.lastSecond;
      if (last !== null) {
        const to = last + 1;
        const from = Math.max(first.status.firstSecond ?? to - OPEN_S, to - OPEN_S);
        const r = await getJson<{ chunks: TelemetryChunk[] }>(`/api/live/${sessionKey}/telemetry?from=${from}&to=${to}&at=${bucketRev}`);
        if (stopped) return;
        add(r.chunks);
        loadedFrom = from;
      } else {
        bucketRev = 0; // none yet: take every second from the start
      }
      cursors = { rows: first.rev, buckets: bucketRev };
      setMeta(first.meta);
      showStatus(first.status);
      setState({ phase: "ready" });
    };

    /** Follows the tick, and its `?after=` continuations, until there is nothing more to fetch now. */
    const follow = async () => {
      let after: number | null = null;
      for (let guard = 0; guard < 100 && !stopped; guard++) {
        const tick: Tick<LiveStatusView> = await getJson(`/api/live/${sessionKey}/tick${after === null ? "" : `?after=${after}`}`);
        if (stopped || !cursors) return;
        const plan = planTick(cursors, tick);
        if ("behind" in plan) {
          after = plan.next;
          continue;
        }
        if (plan.rows.length) setMeta((m) => (m ? mergeLiveRows(m, plan.rows) : m));
        add(plan.chunks);
        cursors = plan.cursors;
        showStatus(plan.status);
        if (plan.next === null) return;
        after = plan.next;
      }
    };

    /** Scrolled back near the start of what is loaded: load the two minutes before it. */
    const scrollBack = async () => {
      const p = playheadRef.current;
      const first = firstSecond;
      if (p === null || loadedFrom === null || first === null || loadedFrom <= first || p >= (loadedFrom + 60) * 1000) return;
      const to: number = loadedFrom;
      const from = Math.max(first, to - OPEN_S);
      const r = await getJson<{ chunks: TelemetryChunk[] }>(`/api/live/${sessionKey}/telemetry?from=${from}&to=${to}&at=${cursors?.buckets ?? 0}`);
      if (stopped) return;
      add(r.chunks);
      loadedFrom = from;
    };

    const poll = async () => {
      if (stopped) return;
      if (document.hidden && cursors) {
        timer = setTimeout(poll, POLL_MS); // nothing to draw: wait until the tab is visible again
        return;
      }
      try {
        if (!cursors) await open();
        else {
          await follow();
          await scrollBack();
        }
        if (stopped) return;
        setFailed(null);
        wait = RETRY_MS;
        timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (stopped) return;
        if (!cursors) {
          setState({ phase: "error", message: e instanceof Error ? e.message : String(e), notLive: notLiveOf(e) });
          return;
        }
        setFailed(e instanceof Error ? e.message : String(e));
        timer = setTimeout(poll, wait);
        wait = Math.min(wait * 2, RETRY_MAX_MS);
      }
    };
    const onVisible = () => {
      if (document.hidden || !cursors) return;
      clearTimeout(timer);
      timer = setTimeout(poll, 0);
    };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(poll, 0);
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
