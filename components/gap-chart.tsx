import { memo } from "react";
import type { Snapshot } from "@/lib/dashboard/model";
import type { StaticView } from "@/lib/dashboard/snapshot";

const W = 430;
const H = 176;
const LEFT = 30;
const RIGHT = 380;
const TOP = 20;
const BOTTOM = 150;

export const GapChart = memo(function GapChart({ view, trend, snapshot }: { view: StaticView; trend: NonNullable<Snapshot["trend"]>; snapshot: Snapshot }) {
  const { fromLap, toLap, series } = trend;
  const leader = snapshot.leader !== null ? view.drivers[snapshot.leader]?.code : null;
  const drawn = series.filter((s) => s.points.length > 0);
  if (toLap <= fromLap || drawn.length === 0) {
    return <p className="note">Not enough completed laps yet to draw a gap trend.</p>;
  }
  const max = Math.max(...drawn.flatMap((s) => s.points.map((p) => p.gap)));
  const step = max > 30 ? 10 : max > 12 ? 5 : 3;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const x = (lap: number) => LEFT + ((lap - fromLap) / (toLap - fromLap)) * (RIGHT - LEFT);
  const y = (gap: number) => BOTTOM - (gap / top) * (BOTTOM - TOP);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const mid = Math.round((fromLap + toLap) / 2);
  const names = drawn.map((s) => view.drivers[s.driver]?.code ?? `#${s.driver}`);

  return (
    <div className="inset" style={{ padding: 14 }}>
      <div className="split" style={{ marginBottom: 6 }}>
        <div className="hd">Gap to leader · laps {fromLap}–{toLap}</div>
        <div className="muted" style={{ fontSize: 13 }}>Seconds behind {leader ?? "the leader"} at the line · lapped cars left out</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Line chart of the gap to the race leader over laps ${fromLap} to ${toLap} for ${names.join(", ")}`} className="map">
        <g stroke="#2e3542" strokeWidth={1}>
          {ticks.map((t) => <line key={t} x1={LEFT} y1={y(t)} x2={RIGHT} y2={y(t)} />)}
        </g>
        <g fill="var(--muted)" fontFamily="var(--mono)" fontSize={11}>
          {ticks.map((t) => <text key={t} x={2} y={y(t) + 4}>{t === 0 ? "0s" : `+${t}`}</text>)}
          {[fromLap, mid, toLap].filter((l, i, a) => a.indexOf(l) === i).map((l) => (
            <text key={l} x={x(l)} y={170} textAnchor="middle">L{l}</text>
          ))}
        </g>
        {drawn.map((s) => {
          const colour = view.drivers[s.driver]?.colour ?? "var(--muted)";
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.driver}>
              <polyline points={s.points.map((p) => `${x(p.lap).toFixed(1)},${y(p.gap).toFixed(1)}`).join(" ")} fill="none" stroke={colour} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              <text x={x(last.lap) + 7} y={y(last.gap) + 5} fill={colour} fontFamily="var(--cond)" fontWeight={700} fontSize={15}>{view.drivers[s.driver]?.code}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
