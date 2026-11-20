"use client";

import { useState } from "react";
import type { SyncPoint } from "@/lib/replay/sync";

type Props = {
  /** Live: the dashboard holds itself behind real time instead of jumping in a replay. */
  live?: boolean;
  points: SyncPoint[];
  /** The point the replay was last synced to, while it still is. */
  synced: SyncPoint | null;
  playing: boolean;
  onSync: (point: SyncPoint) => void;
  onNudge: (ms: number) => void;
};

/**
 * Lines the replay up with a recording of the broadcast playing in another window: pick a moment
 * you will see on the video, press Now as it happens, and the replay jumps there and plays at
 * normal speed alongside it.
 */
export function SyncControl({ live = false, points, synced, playing, onSync, onNudge }: Props) {
  const [choice, setChoice] = useState<string>(points[0]?.id ?? "");
  if (points.length === 0) return null;
  const point = points.find((p) => p.id === choice) ?? points[0];

  return (
    <details className="sync">
      <summary className="tab">{synced ? "Synced to video" : "Sync to video"}</summary>
      <div className="sync-body">
        <p className="note" style={{ margin: 0 }}>
          {live ? (
            <>
              Watching on TV or a stream? Pick a moment, press <strong>Now</strong> when you see it, and the dashboard stays in step with your video.
            </>
          ) : (
            <>
              Watching a recording? Pick a moment, press <strong>Now</strong> when you see it, and the replay plays in step with your video.
            </>
          )}
        </p>
        <div className="sync-row">
          <label htmlFor="sync-point" className="muted" style={{ fontSize: 14 }}>Moment</label>
          <select id="sync-point" className="picker" value={point.id} onChange={(e) => setChoice(e.target.value)}>
            {points.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button className="sync-now" onClick={() => onSync(point)}>Now</button>
        </div>
        {synced && (
          <div className="sync-row" role="group" aria-label="Fine-tune the sync">
            <span role="status" className="muted" style={{ fontSize: 14 }}>
              Synced at {synced.short}
              {playing ? "." : ": paused. Press Play here when you resume the video."}
            </span>
            <span className="sync-nudge">
              <span className="muted" style={{ fontSize: 14 }}>{live ? "Dashboard" : "Replay"} ahead of the video?</span>
              <span className="segmented">
                <button className="seg" onClick={() => onNudge(-5000)}>−5 s</button>
                <button className="seg" onClick={() => onNudge(-500)}>−0.5 s</button>
              </span>
            </span>
            <span className="sync-nudge">
              <span className="muted" style={{ fontSize: 14 }}>Behind?</span>
              <span className="segmented">
                <button className="seg" onClick={() => onNudge(500)}>+0.5 s</button>
                <button className="seg" onClick={() => onNudge(5000)}>+5 s</button>
              </span>
            </span>
          </div>
        )}
      </div>
    </details>
  );
}
