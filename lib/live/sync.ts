import type { TelemetryChunk } from "@/lib/session/types";
import type { LiveRow } from "./merge";

/**
 * The shared live tick: one answer per session that every viewer asks for, so the CDN can serve
 * it from cache (see app/api/live/[key]/tick). It holds every change with a revision in
 * (`from`, `head`]: records and seconds of car data written or improved in roughly the last ten
 * seconds. `more` says changes after `head` exist that did not fit; they are at `?after=<head>`,
 * a URL that is also the same for every viewer.
 *
 * Revisions come from one sequence, taken under a per-session lock until the write commits
 * (live_upsert_rows, live_put_buckets), so the revisions a reader sees for a session have no
 * holes: having read up to `head`, nothing at or below it can turn up later. A record or second
 * changed again gets a new, higher revision and comes in a later tick.
 */
export type Tick<Status = unknown> = {
  from: number;
  head: number;
  more: boolean;
  rows: (LiveRow & { rev: number })[];
  chunks: { rev: number; chunk: TelemetryChunk }[];
  status: Status;
};

/** How far a viewer has read: records and car data are loaded separately on opening. */
export type Cursors = { rows: number; buckets: number };

export type TickPlan<Status> = {
  /** Records and seconds to apply: those newer than what the viewer has. */
  rows: (LiveRow & { rev: number })[];
  chunks: TelemetryChunk[];
  cursors: Cursors;
  /** Ask for `?after=<next>` straight away; null: wait for the next tick. */
  next: number | null;
  status: Status;
} | {
  /** The tick starts after changes this viewer hasn't read: ask for `?after=<next>`, its own catch-up. */
  behind: true;
  next: number;
};

export function planTick<Status>(cursors: Cursors, tick: Tick<Status>): TickPlan<Status> {
  const oldest = Math.min(cursors.rows, cursors.buckets);
  if (oldest < tick.from) return { behind: true, next: oldest };
  return {
    rows: tick.rows.filter((r) => r.rev > cursors.rows),
    chunks: tick.chunks.filter((c) => c.rev > cursors.buckets).map((c) => c.chunk),
    cursors: { rows: Math.max(cursors.rows, tick.head), buckets: Math.max(cursors.buckets, tick.head) },
    next: tick.more ? tick.head : null,
    status: tick.status,
  };
}
