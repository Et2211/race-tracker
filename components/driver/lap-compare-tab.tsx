"use client";

import { useMemo, useState } from "react";
import type { StaticView } from "@/lib/dashboard/snapshot";
import { deltaTrace, topAndMinSpeed, valueAt, type LapOption } from "@/lib/driver/lap-compare";
import type { LapTrace } from "@/lib/driver/lap-trace";
import { formatLapTime, formatSector } from "@/lib/timing/format";

export type TraceState = LapTrace | { error: string } | "loading";

const W = 860;
const LEFT = 64;
const RIGHT = 830;
const GAP = 26;
type Panel = { key: "speed" | "delta" | "throttle" | "brake" | "gear"; label: string; h: number };
const PANELS: Panel[] = [
  { key: "speed", label: "Speed km/h", h: 170 },
  { key: "delta", label: "Gap, s", h: 90 },
  { key: "throttle", label: "Throttle %", h: 60 },
  { key: "brake", label: "Brake", h: 30 },
  { key: "gear", label: "Gear", h: 70 },
];

/** Panels stacked with a shared distance axis. */
const BOXES = PANELS.reduce<(Panel & { top: number; bottom: number })[]>((out, p) => {
  const top = (out.length ? out.at(-1)!.bottom : 0) + GAP;
  return [...out, { ...p, top, bottom: top + p.h }];
}, []);
const H = BOXES.at(-1)!.bottom + 30;

const noteText: Record<NonNullable<LapOption["note"]>, string> = { first: "lap 1", out: "out-lap", in: "in-lap" };
const optionLabel = (o: LapOption) => `L${o.lap} · ${formatLapTime(o.time)}${o.deleted ? " · deleted" : ""}${o.note ? ` · ${noteText[o.note]}` : ""}`;
const isTrace = (s: TraceState | null): s is LapTrace => !!s && s !== "loading" && !("error" in s);

export function LapCompareTab({
  options,
  driver,
  a,
  b,
  onA,
  onB,
  traces,
  sectors,
  view,
}: {
  options: LapOption[];
  driver: number;
  a: LapOption | null;
  b: LapOption | null;
  onA: (o: LapOption) => void;
  onB: (o: LapOption) => void;
  traces: { a: TraceState | null; b: TraceState | null };
  /** Sector boundaries along the lap, metres. */
  sectors: [number, number] | null;
  view: StaticView;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const code = (n: number) => view.drivers[n]?.code ?? `#${n}`;
  const colour = (n: number) => view.drivers[n]?.colour ?? "var(--muted)";
  const mine = options.filter((o) => o.driver === driver);
  const drivers = [...new Set(options.map((o) => o.driver))].sort((x, y) => (view.drivers[x]?.code ?? "").localeCompare(view.drivers[y]?.code ?? ""));
  const bLaps = b ? options.filter((o) => o.driver === b.driver) : [];
  const ta = isTrace(traces.a) ? traces.a : null;
  const tb = isTrace(traces.b) ? traces.b : null;
  const delta = useMemo(() => (ta && tb ? deltaTrace(ta, tb) : null), [ta, tb]);

  if (!mine.length || !a) return <p className="note">No completed laps yet.</p>;

  const nameA = `${code(a.driver)} L${a.lap}`;
  const nameB = b ? `${code(b.driver)} L${b.lap}` : "";
  const problem = (s: TraceState | null, name: string) => (s === "loading" ? `Car data for ${name} is still downloading; the comparison appears once it has loaded.` : s && "error" in s ? `${name}: ${s.error}` : null);
  const problems = [problem(traces.a, nameA), b ? problem(traces.b, nameB) : null].filter(Boolean) as string[];

  const length = Math.max(ta?.length ?? 0, tb?.length ?? 0, 1);
  const x = (d: number) => LEFT + (d / length) * (RIGHT - LEFT);
  const boxes = BOXES;
  const both = [ta, tb].filter(Boolean) as LapTrace[];
  const speedMax = Math.ceil(Math.max(...both.flatMap((l) => [...l.speed]), 100) / 50) * 50;
  const speedMin = Math.floor(Math.min(...both.flatMap((l) => [...l.speed]), speedMax) / 50) * 50;
  const deltaMax = delta ? Math.max(0.2, Math.ceil(Math.max(...delta.delta.map(Math.abs)) * 5) / 5) : 1;
  const scale = (box: (typeof BOXES)[number], v: number, lo: number, hi: number) => box.bottom - ((v - lo) / (hi - lo || 1)) * (box.bottom - box.top);
  const box = (k: Panel["key"]) => boxes.find((p) => p.key === k)!;
  const path = (lap: LapTrace, channel: "speed" | "throttle" | "gear", lo: number, hi: number, step = false) => {
    const bx = box(channel);
    let out = "";
    for (let i = 0; i < lap.d.length; i++) {
      const px = x(lap.d[i]).toFixed(1);
      const py = scale(bx, lap[channel][i], lo, hi).toFixed(1);
      if (i === 0) out += `M${px} ${py}`;
      else if (step) out += `H${px}V${py}`;
      else out += `L${px} ${py}`;
    }
    return out;
  };
  const brakeRuns = (lap: LapTrace) => {
    const runs: [number, number][] = [];
    for (let i = 0; i < lap.d.length; i++) {
      if (!lap.brake[i]) continue;
      const end = i + 1 < lap.d.length ? lap.d[i + 1] : lap.d[i];
      const last = runs.at(-1);
      if (last && Math.abs(last[1] - lap.d[i]) < 1) last[1] = end;
      else runs.push([lap.d[i], end]);
    }
    return runs;
  };
  const kmTicks = Array.from({ length: Math.floor(length / 1000) + 1 }, (_, i) => i * 1000);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(length, ((e.clientX - r.left) / r.width) * length)));
  };
  const deltaAt = (d: number) => {
    if (!delta) return null;
    const i = Math.min(delta.d.length - 1, Math.max(0, Math.round(d / (delta.d[1] - delta.d[0] || 10))));
    return delta.delta[i];
  };
  const speeds = { a: ta ? topAndMinSpeed(ta) : null, b: tb ? topAndMinSpeed(tb) : null };
  const diff = (va: number | null, vb: number | null, fmt: (n: number) => string) => (va === null || vb === null ? "–" : `${va - vb > 0 ? "+" : va - vb < 0 ? "−" : ""}${fmt(Math.abs(va - vb))}`);

  return (
    <div className="driver-tab">
      <div className="lap-pickers">
        <label className="compare">
          <span className="muted">{code(driver)} lap</span>
          <select value={a.lap} onChange={(e) => onA(mine.find((o) => o.lap === Number(e.target.value))!)}>
            {mine.map((o) => <option key={o.lap} value={o.lap}>{optionLabel(o)}</option>)}
          </select>
        </label>
        <label className="compare">
          <span className="muted">Compare with</span>
          <select
            value={b?.driver ?? ""}
            onChange={(e) => {
              const d = Number(e.target.value);
              const laps = options.filter((o) => o.driver === d && !o.deleted && !o.note);
              const pick = laps.sort((x1, x2) => x1.time - x2.time)[0] ?? options.find((o) => o.driver === d);
              if (pick) onB(pick);
            }}
          >
            {drivers.map((d) => <option key={d} value={d}>{code(d)} · {view.drivers[d]?.name ?? ""}</option>)}
          </select>
        </label>
        {b && (
          <label className="compare">
            <span className="muted">{code(b.driver)} lap</span>
            <select value={b.lap} onChange={(e) => onB(bLaps.find((o) => o.lap === Number(e.target.value))!)}>
              {bLaps.map((o) => <option key={o.lap} value={o.lap}>{optionLabel(o)}</option>)}
            </select>
          </label>
        )}
      </div>

      {b && (
        <div className="inset table-scroll" tabIndex={0} role="region" aria-label="Lap comparison by sector">
          <table className="mini">
            <caption className="sr-only">Lap comparison by sector</caption>
            <thead>
              <tr>
                <th scope="col" className="left"><span className="sr-only">Measure</span></th>
                <th scope="col">{nameA}</th>
                <th scope="col">{nameB}</th>
                <th scope="col">Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="left">Lap</th>
                <td className="num">{formatLapTime(a.time)}</td>
                <td className="num">{formatLapTime(b.time)}</td>
                <td className="num">{diff(a.time, b.time, (n) => `${n.toFixed(3)} s`)}</td>
              </tr>
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  <th scope="row" className="left">Sector {i + 1}</th>
                  <td className="num">{formatSector(a.sectors[i])}</td>
                  <td className="num">{formatSector(b.sectors[i])}</td>
                  <td className="num">{diff(a.sectors[i], b.sectors[i], (n) => `${n.toFixed(3)} s`)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="left">Top speed</th>
                <td className="num">{speeds.a ? `${speeds.a.top} km/h` : "–"}</td>
                <td className="num">{speeds.b ? `${speeds.b.top} km/h` : "–"}</td>
                <td className="num">{diff(speeds.a?.top ?? null, speeds.b?.top ?? null, (n) => `${n} km/h`)}</td>
              </tr>
              <tr>
                <th scope="row" className="left">Slowest point</th>
                <td className="num">{speeds.a ? `${speeds.a.min} km/h` : "–"}</td>
                <td className="num">{speeds.b ? `${speeds.b.min} km/h` : "–"}</td>
                <td className="num">{diff(speeds.a?.min ?? null, speeds.b?.min ?? null, (n) => `${n} km/h`)}</td>
              </tr>
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 6 }}>Differences are {nameA} minus {nameB}: a minus time means {nameA} was quicker.</p>
        </div>
      )}

      {problems.map((p) => <p key={p} className="note" role="status">{p}</p>)}

      {both.length > 0 && (
        <>
          <div className="legend" aria-hidden="true">
            <span><svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke={colour(a.driver)} strokeWidth="2" /></svg>{nameA}</span>
            {b && <span><svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke={colour(b.driver)} strokeWidth="2" strokeDasharray="5 3" /></svg>{nameB}</span>}
          </div>
          <div className="chart-wrap" tabIndex={0} role="region" aria-label="Lap comparison charts">
            <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label={`Speed, gap, throttle, brake and gear along the lap for ${nameA}${b ? ` and ${nameB}` : ""}. The table above compares the sectors; the table below gives speeds every 200 metres.`}>
              {boxes.map((bx) => (
                <g key={bx.key}>
                  <text x={LEFT} y={bx.top - 9} fill="var(--muted)" fontFamily="var(--sans)" fontWeight={600} fontSize={11} letterSpacing="0.06em">{bx.label.toUpperCase()}</text>
                  <line x1={LEFT} x2={RIGHT} y1={bx.bottom} y2={bx.bottom} stroke="#2e3542" strokeWidth={1} />
                </g>
              ))}
              {sectors && sectors.map((s, i) => (
                <g key={i}>
                  <line x1={x(s)} x2={x(s)} y1={4} y2={H - 18} stroke="var(--border-strong)" strokeWidth={1} />
                  <text x={x(s) + 4} y={H - 20} fill="var(--muted)" fontFamily="var(--mono)" fontSize={10}>S{i + 2}</text>
                </g>
              ))}
              {/* Speed */}
              {[speedMin, (speedMin + speedMax) / 2, speedMax].map((v) => (
                <g key={v}>
                  <line x1={LEFT} x2={RIGHT} y1={scale(box("speed"), v, speedMin, speedMax)} y2={scale(box("speed"), v, speedMin, speedMax)} stroke="#2e3542" strokeWidth={1} />
                  <text x={LEFT - 8} y={scale(box("speed"), v, speedMin, speedMax) + 4} textAnchor="end" fill="var(--muted)" fontFamily="var(--mono)" fontSize={11}>{v}</text>
                </g>
              ))}
              {ta && <path d={path(ta, "speed", speedMin, speedMax)} fill="none" stroke={colour(a.driver)} strokeWidth={2} strokeLinejoin="round" />}
              {tb && b && <path d={path(tb, "speed", speedMin, speedMax)} fill="none" stroke={colour(b.driver)} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />}
              {/* Gap: above the line, A is ahead. */}
              {delta && (
                <g>
                  <line x1={LEFT} x2={RIGHT} y1={scale(box("delta"), 0, -deltaMax, deltaMax)} y2={scale(box("delta"), 0, -deltaMax, deltaMax)} stroke="var(--border-strong)" strokeWidth={1} />
                  <text x={LEFT - 8} y={box("delta").top + 8} textAnchor="end" fill="var(--muted)" fontFamily="var(--mono)" fontSize={10}>+{deltaMax.toFixed(1)}</text>
                  <text x={LEFT - 8} y={box("delta").bottom} textAnchor="end" fill="var(--muted)" fontFamily="var(--mono)" fontSize={10}>−{deltaMax.toFixed(1)}</text>
                  <path d={delta.d.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)} ${scale(box("delta"), delta.delta[i], -deltaMax, deltaMax).toFixed(1)}`).join("")} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />
                  <text x={RIGHT} y={box("delta").top + 10} textAnchor="end" fill="var(--muted)" fontFamily="var(--sans)" fontSize={11}>↑ {nameA} ahead</text>
                  <text x={RIGHT} y={box("delta").bottom - 4} textAnchor="end" fill="var(--muted)" fontFamily="var(--sans)" fontSize={11}>↓ {nameB} ahead</text>
                </g>
              )}
              {ta && <path d={path(ta, "throttle", 0, 100)} fill="none" stroke={colour(a.driver)} strokeWidth={2} strokeLinejoin="round" />}
              {tb && b && <path d={path(tb, "throttle", 0, 100)} fill="none" stroke={colour(b.driver)} strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />}
              {/* Brake: one strip per lap. */}
              {[ta, tb].map((lap, i) =>
                lap ? (
                  <g key={i}>
                    {brakeRuns(lap).map(([from, to]) => (
                      <rect key={from} x={x(from)} y={box("brake").top + i * (box("brake").h / 2) + 1} width={Math.max(1.5, x(to) - x(from))} height={box("brake").h / 2 - 3} rx={2} fill={i ? "none" : colour(lap.driver)} stroke={i ? colour(lap.driver) : "none"} strokeWidth={i ? 1.5 : 0} />
                    ))}
                  </g>
                ) : null,
              )}
              {ta && <path d={path(ta, "gear", 1, 8, true)} fill="none" stroke={colour(a.driver)} strokeWidth={2} />}
              {tb && b && <path d={path(tb, "gear", 1, 8, true)} fill="none" stroke={colour(b.driver)} strokeWidth={2} strokeDasharray="6 4" />}
              {kmTicks.map((d) => <text key={d} x={x(d)} y={H - 4} textAnchor="middle" fill="var(--muted)" fontFamily="var(--mono)" fontSize={11}>{d / 1000} km</text>)}
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={4} y2={H - 18} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
              <rect x={LEFT} y={0} width={RIGHT - LEFT} height={H - 18} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            </svg>
            {hover !== null && (
              <div className="tooltip" style={{ left: `${Math.min(84, Math.max(16, (x(hover) / W) * 100))}%` }} role="status">
                <div className="hd" style={{ marginBottom: 4 }}>{Math.round(hover)} m</div>
                {both.map((lap, i) => (
                  <div key={i} className="tooltip-row" style={{ fontSize: 14 }}>
                    <span className="bar" style={{ background: colour(lap.driver), height: 12, width: 3 }} />
                    <span>{code(lap.driver)} L{lap.lap}</span>
                    <span className="num" style={{ marginLeft: "auto" }}>
                      {Math.round(valueAt(lap, "speed", hover))} km/h · {Math.round(valueAt(lap, "throttle", hover))}% · G{valueAt(lap, "gear", hover)}
                      {valueAt(lap, "brake", hover) ? " · brake" : ""}
                    </span>
                  </div>
                ))}
                {deltaAt(hover) !== null && <div className="note">{Math.abs(deltaAt(hover)!) < 0.005 ? "Level" : `${deltaAt(hover)! > 0 ? nameA : nameB} ahead by ${Math.abs(deltaAt(hover)!).toFixed(2)} s`}</div>}
              </div>
            )}
          </div>
          <p className="note">
            Car data comes about four times a second, so at top speed the samples are some 20 m apart: braking points and slowest speeds are good to a few metres and km/h. Times are pinned to the official lap and sector times, so the gap is exact at each sector line and good to about a tenth of a second in between. The brake channel is only on or off.
          </p>
          <details className="chart-table">
            <summary>Speeds every 200 m as a table</summary>
            <div className="scroll" tabIndex={0} role="region" aria-label="Speeds every 200 metres">
              <table className="timing">
                <thead>
                  <tr>
                    <th scope="col" className="left">Distance</th>
                    {both.map((lap) => <th key={`${lap.driver}-${lap.lap}`} scope="col">{code(lap.driver)} L{lap.lap}</th>)}
                    {delta && <th scope="col">Gap</th>}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.floor(Math.min(...both.map((l) => l.length)) / 200) + 1 }, (_, i) => i * 200).map((d) => (
                    <tr key={d}>
                      <th scope="row" className="left">{d} m</th>
                      {both.map((lap) => <td key={`${lap.driver}-${lap.lap}`} className="num">{Math.round(valueAt(lap, "speed", d))} km/h</td>)}
                      {delta && <td className="num">{(() => { const v = deltaAt(d)!; return Math.abs(v) < 0.005 ? "level" : `${v > 0 ? code(a.driver) : code(b!.driver)} +${Math.abs(v).toFixed(2)} s`; })()}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
