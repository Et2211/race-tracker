"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TelemetryIndex } from "@/lib/session/telemetry";
import { DATA_FORMAT, type SessionMeta, type TelemetryChunk } from "@/lib/session/types";

export type LoadState = { phase: "meta"; message: string } | { phase: "error"; message: string } | { phase: "ready" };

type ChunkStatus = "missing" | "ready" | "failed";

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

/**
 * Ask the server for an item; it returns the stored copy, or downloads it from OpenF1 first.
 * Plain GETs, so the browser's HTTP cache serves anything it has already seen.
 */
async function load<T>(path: string): Promise<T> {
  return readJsonOrThrow<T>(await fetch(`${path}?v=${DATA_FORMAT}`));
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
function nextWindow(meta: SessionMeta, statuses: ChunkStatus[], t: number): number | undefined {
  const score = (w: SessionMeta["windows"][number]) => (t >= w.from && t < w.to ? -Infinity : w.from >= t ? w.from - t : 1e13 + (t - w.from));
  return [...meta.windows].sort((a, b) => score(a) - score(b)).find((w) => statuses[w.index] === "missing")?.index;
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
    entry.meta ? { phase: "ready" } : { phase: "meta", message: "Loading timing, flags and results. The first time a session is opened it is downloaded from OpenF1, which takes about 30 seconds" },
  );
  const [statuses, setStatuses] = useState<ChunkStatus[]>(entry.meta ? entry.meta.windows.map((w) => (entry.telemetry.has(w.index) ? "ready" : "missing")) : []);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const telemetry = entry.telemetry;
  const inFlight = useRef<number | null>(null);

  useEffect(() => {
    if (entry.meta) return;
    let cancelled = false;
    // Shared, so React running this effect twice in development makes one request.
    entry.loading ??= load<SessionMeta>(`/api/sessions/${sessionKey}/meta`);
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
  useEffect(() => {
    if (!meta || inFlight.current !== null) return;
    const next = nextWindow(meta, statuses, t);
    if (next === undefined) return;
    inFlight.current = next;
    load<TelemetryChunk>(`/api/sessions/${meta.session.session_key}/chunks/${next}`)
      .then((chunk) => {
        telemetry.add(chunk);
        inFlight.current = null;
        setStatuses((s) => s.map((x, i) => (i === next ? "ready" : x)));
        setVersion((v) => v + 1);
      })
      .catch((e: unknown) => {
        inFlight.current = null;
        setChunkError(e instanceof Error ? e.message : String(e));
        setStatuses((s) => s.map((x, i) => (i === next ? "failed" : x)));
      });
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
