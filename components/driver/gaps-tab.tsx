"use client";

import { useState } from "react";
import type { StaticView } from "@/lib/dashboard/snapshot";
import type { GapLap } from "@/lib/driver/gaps";

const W = 860;
const H = 300;
const LEFT = 56;
const RIGHT = 820;
const TOP = 28;
const BOTTOM = 262;
/** Gaps beyond this are "clear air" and sit at the edge of the chart. */
const CAP = 10;
/** Checked with the data-viz palette validator against the panel colour (#161a21): both pass every check. */
const AHEAD = "#3987e5";
const BEHIND = "#d95926";

export type GapEvent = { lap: number; kind: "pit" | "gained" | "lost"; other: number | null };

export function GapsTab({ gaps, events, neutralLaps, view, aid }: { gaps: GapLap[]; events: GapEvent[]; neutralLaps: Set<number>; view: StaticView; aid: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const code = (n: number) => view.drivers[n]?.code ?? `#${n}`;
  if (gaps.length < 2) return <p className="note">Gaps appear once the driver has completed a couple of laps.</p>;

  const first = gaps[0].lap;
  const last = gaps.at(-1)!.lap;
  const x = (lap: number) => LEFT + ((lap - first) / Math.max(1, last - first)) * (RIGHT - LEFT);
  const mid = (TOP + BOTTOM) / 2;
  // Ahead plots up from the middle, behind plots down: the driver is the line in the middle.
  const y = (gap: number, side: 1 | -1) => mid - side * (Math.min(gap, CAP) / CAP) * (mid - TOP);
  const ticks = [-10, -5, -1, 0, 1, 5, 10];
  const lapStep = last - first > 40 ? 10 : 5;
  const lapTicks = gaps.map((g) => g.lap).filter((l) => l === first || l % lapStep === 0);
  const slot = (RIGHT - LEFT) / Math.max(1, last - first);
  const byLap = new Map(gaps.map((g) => [g.lap, g]));
  const h = hover !== null ? byLap.get(hover) : undefined;

  const line = (side: 1 | -1) => {
    const pts = gaps.map((g) => {
      const v = side === 1 ? g.ahead : g.behind;
      return v ? `${x(g.lap).toFixed(1)},${y(v.gap, side).toFixed(1)}` : null;
    });
    // Break the line where there is no car on that side.
    const runs: string[][] = [[]];
    for (const p of pts) {
      if (p) runs.at(-1)!.push(p);
      else if (runs.at(-1)!.length) runs.push([]);
    }
    return runs.filter((r) => r.length > 1);
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - box.left) / box.width;
    const lap = Math.round(first + f * (last - first));
    setHover(byLap.has(lap) ? lap : null);
  };

  return (
    <div className="driver-tab">
      <div className="legend" aria-hidden="true">
        <span><svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke={AHEAD} strokeWidth="2" /></svg>Car ahead</span>
        <span><svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke={BEHIND} strokeWidth="2" strokeDasharray="5 3" /></svg>Car behind</span>
        <span><svg width="14" height="10"><rect width="14" height="10" fill="var(--text)" opacity="0.08" /></svg>Within a second ({aid} range)</span>
        <span><svg width="14" height="10"><rect width="14" height="10" fill="var(--yellow)" opacity="0.12" /></svg>Safety car, VSC or red flag</span>
      </div>

      <div className="chart-wrap" tabIndex={0} role="region" aria-label="Gap chart">
        <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label={`Gaps at the line to the cars directly ahead and behind, lap by lap, from lap ${first} to ${last}. The table below lists them.`}>
          {gaps.filter((g) => neutralLaps.has(g.lap)).map((g) => (
            <rect key={`n${g.lap}`} x={x(g.lap) - slot / 2} y={TOP} width={slot} height={BOTTOM - TOP} fill="var(--yellow)" opacity={0.12} />
          ))}
          <rect x={LEFT} y={y(1, 1)} width={RIGHT - LEFT} height={y(1, -1) - y(1, 1)} fill="var(--text)" opacity={0.08} />
          <g stroke="#2e3542" strokeWidth={1}>
            {ticks.map((v) => <line key={v} x1={LEFT} x2={RIGHT} y1={y(Math.abs(v), v >= 0 ? 1 : -1)} y2={y(Math.abs(v), v >= 0 ? 1 : -1)} />)}
          </g>
          <g fill="var(--muted)" fontFamily="var(--mono)" fontSize={11}>
            {ticks.filter((v) => v !== 0).map((v) => <text key={v} x={LEFT - 8} y={y(Math.abs(v), v > 0 ? 1 : -1) + 4} textAnchor="end">{`${Math.abs(v)}${Math.abs(v) === CAP ? "+" : ""} s`}</text>)}
            {lapTicks.map((l) => <text key={l} x={x(l)} y={H - 4} textAnchor="middle">L{l}</text>)}
            <text x={LEFT} y={TOP - 12}>↑ to the car ahead</text>
            <text x={LEFT} y={BOTTOM + 16}>↓ to the car behind</text>
          </g>
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BOTTOM} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
          {line(1).map((r, i) => <polyline key={`a${i}`} points={r.join(" ")} fill="none" stroke={AHEAD} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {line(-1).map((r, i) => <polyline key={`b${i}`} points={r.join(" ")} fill="none" stroke={BEHIND} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 4" />)}
          <line x1={LEFT} x2={RIGHT} y1={mid} y2={mid} stroke="var(--text)" strokeWidth={1.5} />
          {/* Pit stops and passes on track, on the driver's line. */}
          {events.map((e, i) =>
            e.lap < first || e.lap > last ? null : e.kind === "pit" ? (
              <g key={i}>
                <rect x={x(e.lap) - 13} y={mid - 8} width={26} height={16} rx={3} fill="var(--inset)" stroke="var(--border-strong)" />
                <text x={x(e.lap)} y={mid + 4} textAnchor="middle" fontFamily="var(--mono)" fontSize={10} fill="var(--text)">PIT</text>
              </g>
            ) : (
              <path key={i} d={e.kind === "gained" ? `M${x(e.lap)} ${mid - 9} l5 8 h-10 Z` : `M${x(e.lap)} ${mid + 9} l5 -8 h-10 Z`} fill="var(--text)" stroke="var(--panel)" strokeWidth={1.5} />
            ),
          )}
          {h?.ahead && <circle cx={x(h.lap)} cy={y(h.ahead.gap, 1)} r={4.5} fill={AHEAD} stroke="var(--panel)" strokeWidth={2} />}
          {h?.behind && <circle cx={x(h.lap)} cy={y(h.behind.gap, -1)} r={4.5} fill="var(--panel)" stroke={BEHIND} strokeWidth={2} />}
          <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {h && (
          <div className="tooltip" style={{ left: `${Math.min(84, Math.max(16, (x(h.lap) / W) * 100))}%` }} role="status">
            <div className="hd" style={{ marginBottom: 4 }}>Lap {h.lap} · P{h.position}</div>
            <div className="tooltip-row"><span className="bar" style={{ background: AHEAD, height: 12, width: 3 }} />Ahead<span className="num" style={{ marginLeft: "auto" }}>{h.ahead ? `${code(h.ahead.driver)} ${h.ahead.gap.toFixed(1)} s` : "–"}</span></div>
            <div className="tooltip-row"><span className="bar" style={{ background: BEHIND, height: 12, width: 3 }} />Behind<span className="num" style={{ marginLeft: "auto" }}>{h.behind ? `${code(h.behind.driver)} ${h.behind.gap.toFixed(1)} s` : "–"}</span></div>
            <div className="note">{h.toLeader === 0 ? "Leading" : `${h.toLeader.toFixed(1)} s to the leader`}</div>
            {events.filter((e) => e.lap === h.lap).map((e, i) => (
              <div key={i} className="note">{e.kind === "pit" ? "Pit stop" : e.kind === "gained" ? `Passed ${e.other !== null ? code(e.other) : "a car"}` : `Passed by ${e.other !== null ? code(e.other) : "a car"}`}</div>
            ))}
          </div>
        )}
      </div>
      <p className="note">
        Gaps at the line: how long before the driver the car directly ahead on the same lap crossed it, and how long after the car directly behind did. Taken from OpenF1&apos;s lap start times, which are good to about a tenth of a second. Gaps over {CAP} s sit at the edge. Triangles on the line are passes on track (up: gained a place, down: lost one); places changed around pit stops are in the summary.
      </p>

      <details className="chart-table">
        <summary>Gaps as a table</summary>
        <div className="scroll" tabIndex={0} role="region" aria-label="Gaps lap by lap">
          <table className="timing">
            <thead>
              <tr>
                <th scope="col" className="left">Lap</th>
                <th scope="col">Place</th>
                <th scope="col">Car ahead</th>
                <th scope="col">Car behind</th>
                <th scope="col">To leader</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.lap}>
                  <th scope="row" className="left">{g.lap}{neutralLaps.has(g.lap) ? " (neutralised)" : ""}</th>
                  <td className="num">P{g.position}</td>
                  <td className="num">{g.ahead ? `${code(g.ahead.driver)} ${g.ahead.gap.toFixed(1)} s` : "–"}</td>
                  <td className="num">{g.behind ? `${code(g.behind.driver)} ${g.behind.gap.toFixed(1)} s` : "–"}</td>
                  <td className="num">{g.toLeader === 0 ? "–" : `${g.toLeader.toFixed(1)} s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
