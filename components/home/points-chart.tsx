"use client";

import { useState } from "react";
import type { Progression } from "@/lib/home/data";

const W = 720;
const H = 300;
const LEFT = 44;
const RIGHT = 640;
const TOP = 16;
const BOTTOM = 260;

/** Points of the current top five after each round. Team colours come from the data. */
export function PointsChart({ progression, year }: { progression: Progression; year: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const { rounds, series } = progression;
  if (rounds.length < 2) return <p className="note">The points chart starts after the second round.</p>;

  const max = Math.max(...series.flatMap((s) => s.points.filter((p): p is number => p !== null)), 1);
  const step = max > 300 ? 100 : max > 120 ? 50 : 25;
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => LEFT + (i / (rounds.length - 1)) * (RIGHT - LEFT);
  const y = (v: number) => BOTTOM - (v / top) * (BOTTOM - TOP);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(rounds.length / 8);

  // Direct labels at the line ends, nudged apart so they never overlap.
  const ends = series
    .map((s) => {
      const i = s.points.findLastIndex((p) => p !== null);
      return { s, y: i >= 0 ? y(s.points[i]!) : BOTTOM };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (RIGHT - LEFT);
    setHover(Math.max(0, Math.min(rounds.length - 1, Math.round((px / (RIGHT - LEFT)) * (rounds.length - 1)))));
  };

  return (
    <section className="panel" aria-labelledby="points-title">
      <div className="split">
        <h2 id="points-title">Points through {year}</h2>
        <div className="legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.driver}>
              <svg width="22" height="8"><line x1="1" y1="4" x2="21" y2="4" stroke={s.colour} strokeWidth="2.5" strokeDasharray={s.dashed ? "5 3" : undefined} /></svg>
              {s.code}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label={`Line chart of championship points after each round of ${year} for ${series.map((s) => s.code).join(", ")}. The standings table above lists the current points.`}>
          <g stroke="#2e3542" strokeWidth={1}>
            {ticks.map((t) => <line key={t} x1={LEFT} x2={RIGHT} y1={y(t)} y2={y(t)} />)}
          </g>
          <g fill="var(--muted)" fontFamily="var(--mono)" fontSize={11}>
            {ticks.map((t) => <text key={t} x={LEFT - 8} y={y(t) + 4} textAnchor="end">{t}</text>)}
            {rounds.map((r, i) => (i % labelEvery === 0 || i === rounds.length - 1 ? <text key={i} x={x(i)} y={H - 18} textAnchor="middle">R{r.round}</text> : null))}
          </g>
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BOTTOM} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
          {series.map((s) => {
            const pts = s.points.map((p, i) => (p === null ? null : `${x(i).toFixed(1)},${y(p).toFixed(1)}`)).filter(Boolean);
            return (
              <g key={s.driver}>
                <polyline points={pts.join(" ")} fill="none" stroke={s.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "6 4" : undefined} />
                {hover !== null && s.points[hover] !== null && <circle cx={x(hover)} cy={y(s.points[hover]!)} r={4.5} fill={s.colour} stroke="var(--panel)" strokeWidth={2} />}
              </g>
            );
          })}
          <g fontFamily="var(--cond)" fontWeight={700} fontSize={14} fill="var(--text)">
            {ends.map(({ s, y: ly }) => (
              <text key={s.driver} x={RIGHT + 10} y={ly + 5}>{s.code}</text>
            ))}
          </g>
          <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
            <div className="hd" style={{ marginBottom: 4 }}>R{rounds[hover].round} · {rounds[hover].label}</div>
            {[...series]
              .sort((a, b) => (b.points[hover] ?? -1) - (a.points[hover] ?? -1))
              .map((s) => (
                <div key={s.driver} className="tooltip-row">
                  <span className="bar" style={{ background: s.colour, height: 12, width: 3 }} />
                  <span>{s.code}</span>
                  <span className="num" style={{ marginLeft: "auto" }}>{s.points[hover] ?? "–"}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      {progression.missing > 0 && <p className="note">{progression.missing} round{progression.missing > 1 ? "s are" : " is"} not drawn yet: their standings are fetched by the daily calendar job.</p>}
    </section>
  );
}
