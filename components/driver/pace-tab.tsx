"use client";

import { useState } from "react";
import { useChartPointer } from "@/components/use-chart-pointer";
import type { StaticView } from "@/lib/dashboard/snapshot";
import type { PaceLap, StintPace } from "@/lib/driver/pace";
import { formatLapTime } from "@/lib/timing/format";
import { compoundColour, compoundName } from "./tyres";

const W = 860;
const H = 300;
const LEFT = 64;
const RIGHT = 800;
const TOP = 16;
const BOTTOM = 230;
const BAND = 8;

/** Axis label: m:ss, with a tenth only on half-second ticks. */
const tick = (v: number) => `${Math.floor(v / 60)}:${(v % 60).toFixed(v % 1 ? 1 : 0).padStart(v % 1 ? 4 : 2, "0")}`;

const STATUS: Record<PaceLap["status"], string> = { clean: "", first: "standing start", in: "pit in-lap", out: "pit out-lap", neutralised: "safety car, VSC or red flag", slow: "over 7% off their best" };

export type PaceSeries = { driver: number; laps: PaceLap[]; stints: StintPace[] };

function trendText(trend: number | null): string {
  if (trend === null) return "–";
  if (Math.abs(trend) < 0.005) return "0.00 s/lap";
  return `${trend > 0 ? "+" : "−"}${Math.abs(trend).toFixed(2)} s/lap`;
}

export function PaceTab({ main, rival, rivals, onRival, view }: { main: PaceSeries; rival: PaceSeries | null; rivals: number[]; onRival: (driver: number) => void; view: StaticView }) {
  const [hover, setHover] = useState<number | null>(null);
  const pointer = useChartPointer(hover !== null, () => setHover(null));
  const series = rival ? [main, rival] : [main];
  const code = (n: number) => view.drivers[n]?.code ?? `#${n}`;
  const colour = (n: number) => view.drivers[n]?.colour ?? "var(--muted)";

  const allLaps = series.flatMap((s) => s.laps);
  const lastLap = Math.max(1, ...allLaps.map((l) => l.lap));
  const clean = allLaps.filter((l) => l.status === "clean").map((l) => l.time);
  // The scale fits the clean laps; slower laps (stops, safety cars) sit at the top edge.
  const lo = clean.length ? Math.min(...clean) : Math.min(...allLaps.map((l) => l.time), 90);
  const hi = clean.length ? Math.max(...clean) : lo + 5;
  const step = hi - lo > 6 ? 2 : hi - lo > 3 ? 1 : 0.5;
  const yMin = Math.floor((lo - 0.2) / step) * step;
  const yMax = Math.ceil((hi + 0.2) / step) * step;
  const x = (lap: number) => LEFT + ((lap - 1) / Math.max(1, lastLap - 1)) * (RIGHT - LEFT);
  const y = (time: number) => (time > yMax ? TOP : BOTTOM - ((time - yMin) / (yMax - yMin)) * (BOTTOM - TOP));
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v);
  const lapTicks = Array.from({ length: lastLap }, (_, i) => i + 1).filter((l) => l === 1 || l % (lastLap > 40 ? 10 : 5) === 0);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - box.left) / box.width;
    setHover(Math.max(1, Math.min(lastLap, Math.round(1 + f * (lastLap - 1)))));
  };

  if (!main.laps.length) return <p className="note">No completed laps yet.</p>;

  return (
    <div className="driver-tab">
      <div className="split">
        <div className="legend" aria-hidden="true">
          {series.map((s, i) => (
            <span key={s.driver}>
              <svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke={colour(s.driver)} strokeWidth="2" strokeDasharray={i ? "5 3" : undefined} /></svg>
              {code(s.driver)}
            </span>
          ))}
          <span>
            <svg width="12" height="12"><path d="M6 2 L10 10 L2 10 Z" fill="none" stroke="var(--muted)" strokeWidth="1.5" /></svg>
            Off the scale (stop, safety car)
          </span>
        </div>
        <label className="compare">
          <span className="muted">Compare with</span>
          <select value={rival?.driver ?? ""} onChange={(e) => onRival(Number(e.target.value))}>
            {rivals.map((d) => <option key={d} value={d}>{code(d)} · {view.drivers[d]?.name ?? ""}</option>)}
          </select>
        </label>
      </div>

      <div className="chart-wrap" tabIndex={0} role="region" aria-label="Lap time chart">
        <div className="chart-canvas">
          <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label={`Lap times of ${series.map((s) => code(s.driver)).join(" and ")} by lap. The stint table below gives each stint's typical lap and trend.`}>
            <g stroke="#2e3542" strokeWidth={1}>
              {ticks.map((v) => <line key={v} x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} />)}
            </g>
            <g fill="var(--muted)" fontFamily="var(--mono)" fontSize={11}>
              {ticks.map((v) => <text key={v} x={LEFT - 8} y={y(v) + 4} textAnchor="end">{tick(v)}</text>)}
              {lapTicks.map((l) => <text key={l} x={x(l)} y={H - 6} textAnchor="middle">L{l}</text>)}
            </g>
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={BOTTOM} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
            {series.map((s, si) => {
              // Lines join consecutive clean laps of one stint; anything else breaks the line.
              const runs: PaceLap[][] = [];
              for (const l of s.laps) {
                const prev = runs.at(-1)?.at(-1);
                if (l.status !== "clean") continue;
                if (prev && prev.lap === l.lap - 1 && prev.stint === l.stint) runs.at(-1)!.push(l);
                else runs.push([l]);
              }
              const c = colour(s.driver);
              return (
                <g key={s.driver}>
                  {runs.map((r) =>
                    r.length === 1 ? (
                      <circle key={r[0].lap} cx={x(r[0].lap)} cy={y(r[0].time)} r={4} fill={si ? "var(--panel)" : c} stroke={si ? c : "var(--panel)"} strokeWidth={2} />
                    ) : (
                    <polyline key={r[0].lap} points={r.map((l) => `${x(l.lap).toFixed(1)},${y(l.time).toFixed(1)}`).join(" ")} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={si ? "6 4" : undefined} />
                    ),
                  )}
                  {s.laps.map((l) =>
                    l.time > yMax ? (
                      <path key={l.lap} d={`M${x(l.lap)} ${TOP - 4} l4 8 h-8 Z`} fill="none" stroke={c} strokeWidth={1.5} />
                    ) : l.status !== "clean" || l.deleted ? (
                      <circle key={l.lap} cx={x(l.lap)} cy={y(l.time)} r={4} fill="var(--panel)" stroke={c} strokeWidth={2} />
                    ) : hover === l.lap ? (
                      <circle key={l.lap} cx={x(l.lap)} cy={y(l.time)} r={4.5} fill={si ? "var(--panel)" : c} stroke={si ? c : "var(--panel)"} strokeWidth={2} />
                    ) : null,
                  )}
                  {/* Tyres: a band per driver under the axis, coloured by compound. */}
                  {s.laps.map((l) => (
                    <rect key={`t${l.lap}`} x={x(l.lap) - (RIGHT - LEFT) / Math.max(1, lastLap - 1) / 2 + 0.5} y={BOTTOM + 10 + si * (BAND + 6)} width={Math.max(1, (RIGHT - LEFT) / Math.max(1, lastLap - 1) - 1)} height={BAND} rx={2} fill={compoundColour(l.compound)} opacity={l.status === "clean" ? 1 : 0.55} />
                  ))}
                  <text x={RIGHT + 10} y={BOTTOM + 10 + si * (BAND + 6) + BAND - 1} fill="var(--muted)" fontFamily="var(--mono)" fontSize={11}>{code(s.driver)}</text>
                </g>
              );
            })}
            <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="transparent" {...pointer.props(onMove)} />
          </svg>
          {hover !== null && (
            <div className="tooltip" style={{ left: `${Math.min(84, Math.max(16, (x(hover) / W) * 100))}%` }} role="status">
              <div className="hd" style={{ marginBottom: 4 }}>Lap {hover}</div>
              {series.map((s) => {
                const l = s.laps.find((p) => p.lap === hover);
                return (
                  <div key={s.driver} style={{ marginTop: 2 }}>
                    <div className="tooltip-row">
                      <span className="bar" style={{ background: colour(s.driver), height: 12, width: 3 }} />
                      <span>{code(s.driver)}</span>
                      <span className="num" style={{ marginLeft: "auto" }}>{l ? formatLapTime(l.time) : "–"}</span>
                    </div>
                    {l && (
                      <div className="note">
                        {compoundName(l.compound)}{l.age !== null ? `, ${l.age} laps old` : ""}
                        {STATUS[l.status] ? ` · ${STATUS[l.status]}` : ""}
                        {l.deleted ? " · deleted" : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <p className="note">
        Hollow dots: laps that don&apos;t show pace (standing start, pit laps, safety car, VSC or red flag, or over 7% off the driver&apos;s best so far) or whose time was deleted. The bands under the chart are each driver&apos;s tyres, lap by lap.
      </p>

      <div className="driver-cols">
        {series.map((s) => (
          <div key={s.driver} className="inset">
            <div className="hd">{code(s.driver)} stints</div>
            <table className="mini">
              <caption className="sr-only">{code(s.driver)} stints</caption>
              <thead>
                <tr>
                  <th scope="col" className="left">Tyres</th>
                  <th scope="col">Laps</th>
                  <th scope="col">Typical lap</th>
                  <th scope="col">Trend</th>
                </tr>
              </thead>
              <tbody>
                {s.stints.map((st) => (
                  <tr key={st.stint}>
                    <th scope="row" className="left">
                      <span className="swatch" style={{ background: compoundColour(st.compound) }} aria-hidden="true" /> {compoundName(st.compound)}
                    </th>
                    <td className="num">{st.fromLap}–{st.toLap}</td>
                    <td className="num">{st.median !== null ? formatLapTime(st.median) : "–"}</td>
                    <td className="num">{trendText(st.trend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="note">
        Typical lap: the median of the stint&apos;s clean laps. Trend: how much the clean laps changed per lap of tyre age, from a straight-line fit, shown once a stint has five clean laps; + means slower, − quicker. It is not tyre wear on its own: cars also get lighter as fuel burns and the track rubbers in, which makes laps quicker, so a stint that gets quicker can still be wearing its tyres.
      </p>

      <details className="chart-table">
        <summary>Lap times as a table</summary>
        <div className="scroll" tabIndex={0} role="region" aria-label="Lap times">
          <table className="timing">
            <thead>
              <tr>
                <th scope="col" className="left">Lap</th>
                {series.map((s) => <th key={s.driver} scope="col">{code(s.driver)}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: lastLap }, (_, i) => i + 1).map((lap) => (
                <tr key={lap}>
                  <th scope="row" className="left">{lap}</th>
                  {series.map((s) => {
                    const l = s.laps.find((p) => p.lap === lap);
                    return <td key={s.driver} className="num">{l ? `${formatLapTime(l.time)} ${compoundName(l.compound).charAt(0)}${STATUS[l.status] ? ` (${STATUS[l.status]})` : ""}${l.deleted ? " deleted" : ""}` : "–"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
