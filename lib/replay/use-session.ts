"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TelemetryIndex } from "@/lib/session/telemetry";
import { DATA_FORMAT, type SessionMeta, type TelemetryChunk } from "@/lib/session/types";
import type { NotLive } from "@/lib/live/not-live";

/** `notLive`: a live session that could not be opened, and why (not started, or ended). */
export type LoadState = { phase: "meta"; message: string } | { phase: "error"; message: string; notLive?: NotLive } | { phase: "ready" };

type ChunkStatus = "missing" | "ready" | "failed";

/** A failed request: whether trying again could help, and how long the server asked us to wait. */
class LoadError extends Error {
  constructor(message: string, readonly permanent: boolean, readonly retryAfterMs: number | null) {
    super(message);
  }
}

/** Answers that will not change by asking again soon: bad key, no such session, replay not open yet, storage full. */
const PERMANENT = new Set([400, 404, 409, 507]);

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const after = Number(res.headers.get("retry-after"));
    throw new LoadError(body?.error ?? `HTTP ${res.status}`, PERMANENT.has(res.status), Number.isFinite(after) && after > 0 ? after * 1000 : null);
  }
  return body as T;
}

/**
 * Ask the server for an item; it returns the stored copy, or downloads it from OpenF1 first.
 * Plain GETs, so the browser's HTTP cache serves anything it has already seen.
 */
async function fetchItem(path: string): Promise<Response> {
  try {
    return await fetch(`${path}?v=${DATA_FORMAT}`);
  } catch (e) {
    throw new LoadError(e instanceof Error ? e.message : String(e), false, null); // offline, connection dropped
  }
}

async function load<T>(path: string): Promise<T> {
  return readJsonOrThrow<T>(await fetchItem(path));
}

/** Waits before each automatic retry; after the last, the error is shown with a Retry button. */
const RETRY_WAITS_MS = [2_000, 5_000, 15_000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `fn`, tried again after a wait when it fails in a way that may pass (busy, rate limited, offline). */
async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= RETRY_WAITS_MS.length || (e instanceof LoadError && e.permanent)) throw e;
      await sleep(Math.max(RETRY_WAITS_MS[i], e instanceof LoadError ? (e.retryAfterMs ?? 0) : 0));
    }
  }
}

/** Parts asked for at once while they come from storage; one at a time while each is an OpenF1 download. */
const PARALLEL_STORED = 3;

/** One telemetry part, and whether it came back quickly (stored, or from the CDN's cache). */
async function loadChunk(sessionKey: number, index: number): Promise<{ chunk: TelemetryChunk; quick: boolean }> {
  const res = await fetchItem(`/api/sessions/${sessionKey}/chunks/${index}`);
  const quick = res.headers.get("x-data-source") === "store" || /HIT|STALE/.test(res.headers.get("x-vercel-cache") ?? "");
  return { chunk: await readJsonOrThrow<TelemetryChunk>(res), quick };
}

/**
 * Sessions opened in this tab, kept decoded so going back to one is instant. The last two are
 * kept: a race's telemetry takes tens of megabytes once decoded.
 */
const opened = new Map<number, { meta: SessionMeta | null; loading: Promise<SessionMeta> | null; telemetry: TelemetryIndex }>();
function remember(sessionKey: number) {
  let entry = opened.get(sessionKey);
  if (entry) opened.delete(sessionKey);
  else entry = { meta: null, loading: null, telemetry: new TelemetryIndex() };
  opened.set(sessionKey, entry);
  while (opened.size > 2) opened.delete(opened.keys().next().value!);
  return entry;
}

/** Window order: the one under the playhead, then later ones, then earlier ones. */
function nextWindow(meta: SessionMeta, statuses: ChunkStatus[], t: number, busy: Set<number>): number | undefined {
  const score = (w: SessionMeta["windows"][number]) => (t >= w.from && t < w.to ? -Infinity : w.from >= t ? w.from - t : 1e13 + (t - w.from));
  return [...meta.windows].sort((a, b) => score(a) - score(b)).find((w) => statuses[w.index] === "missing" && !busy.has(w.index))?.index;
}

/**
 * Loads one session: metadata first (ingesting it from OpenF1 the first time), then telemetry
 * windows one at a time, nearest to the playhead first. Requests are sequential so the server
 * stays within OpenF1's rate limit. Mount once per session (key the component by session).
 */
export function useSession(sessionKey: number, playhead: number | null) {
  const [entry] = useState(() => remember(sessionKey));
  const [meta, setMeta] = useState<SessionMeta | null>(entry.meta);
  const [state, setState] = useState<LoadState>(
    entry.meta ? { phase: "ready" } : { phase: "meta", message: "Loading timing, flags and results. The first time can take about 30 seconds" },
  );
  const [statuses, setStatuses] = useState<ChunkStatus[]>(entry.meta ? entry.meta.windows.map((w) => (entry.telemetry.has(w.index) ? "ready" : "missing")) : []);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const telemetry = entry.telemetry;
  const inFlight = useRef(new Set<number>());
  // How many parts to ask for at once: decided by where the last one came from.
  const parallel = useRef(1);

  useEffect(() => {
    if (entry.meta) return;
    let cancelled = false;
    // Shared, so React running this effect twice in development makes one request.
    entry.loading ??= retrying(() => load<SessionMeta>(`/api/sessions/${sessionKey}/meta`));
    entry.loading
      .then((m) => {
        entry.meta = m;
        if (cancelled) return;
        setMeta(m);
        setStatuses(m.windows.map((w) => (telemetry.has(w.index) ? "ready" : "missing")));
        setState({ phase: "ready" });
      })
      .catch((e: unknown) => {
        entry.loading = null;
        if (!cancelled) setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey, attempt, telemetry, entry]);

  const t = playhead ?? meta?.span.start ?? 0;
  // Telemetry parts, nearest the playhead first, a few at a time; runs again as each one lands.
  useEffect(() => {
    if (!meta) return;
    while (inFlight.current.size < parallel.current) {
      const next = nextWindow(meta, statuses, t, inFlight.current);
      if (next === undefined) return;
      inFlight.current.add(next);
      retrying(() => loadChunk(meta.session.session_key, next))
        .then(({ chunk, quick }) => {
          telemetry.add(chunk);
          inFlight.current.delete(next);
          parallel.current = quick ? PARALLEL_STORED : 1;
          setStatuses((s) => s.map((x, i) => (i === next ? "ready" : x)));
          setVersion((v) => v + 1);
        })
        .catch((e: unknown) => {
          inFlight.current.delete(next);
          setChunkError(e instanceof Error ? e.message : String(e));
          setStatuses((s) => s.map((x, i) => (i === next ? "failed" : x)));
        });
    }
  }, [meta, statuses, t, telemetry]);

  const retry = useCallback(() => {
    setState({ phase: "meta", message: "Retrying" });
    setAttempt((a) => a + 1);
  }, []);
  const retryChunks = useCallback(() => {
    setChunkError(null);
    setStatuses((s) => s.map((x) => (x === "failed" ? "missing" : x)));
  }, []);

  return {
    meta,
    state,
    retry,
    telemetry,
    /** Changes whenever more telemetry has loaded. */
    version,
    progress: { ready: statuses.filter((c) => c === "ready").length, total: statuses.length, failed: statuses.filter((c) => c === "failed").length, error: chunkError },
    retryChunks,
  };
}
