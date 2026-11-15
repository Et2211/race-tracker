"use client";

import { useRef } from "react";
import type { Snapshot } from "@/lib/dashboard/model";
import type { StaticView } from "@/lib/dashboard/snapshot";
import type { RaceRow } from "@/lib/timing/race";
import { useRowFlip } from "./use-row-flip";
import { formatGap } from "@/lib/timing/gap";
import { formatLapTime, formatSector } from "@/lib/timing/format";
import type { Mark, QualifyingPhase } from "@/lib/timing/qualifying";

type Select = { selected: number | null; onSelect: (driver: number) => void };

/** A sector time. Purple and green also carry a shape and hidden text, so colour is never the only cue. */
function Time({ value, mark }: { value: number | null; mark: Mark }) {
  return (
    <span className={`tm ${mark ?? ""}`}>
      {mark && <span className="cue" aria-hidden="true">{mark === "purple" ? "◆" : "▲"}</span>}
      {formatSector(value)}
      {mark && <span className="sr-only">{mark === "purple" ? " fastest overall" : " personal best"}</span>}
    </span>
  );
}

export function MarkLegend() {
  return (
    <>
      <span><span className="tm purple" style={{ display: "inline", padding: "2px 6px" }}><span className="cue" aria-hidden="true">◆</span>purple</span> fastest overall</span>
      <span><span className="tm green" style={{ display: "inline", padding: "2px 6px" }}><span className="cue" aria-hidden="true">▲</span>green</span> personal best</span>
    </>
  );
}

function DriverCell({ view, driver, selected, onSelect, showName, tag }: Select & { view: StaticView; driver: number; showName?: boolean; tag?: string }) {
  const d = view.drivers[driver];
  return (
    <th scope="row">
      <button className="drv" data-driver={driver} onClick={() => onSelect(driver)} aria-pressed={selected === driver}>
        <span className="bar" style={{ background: d?.colour }} />
        <span className="code">{d?.code ?? `#${driver}`}</span>
        {showName && <span className="name">{d?.name}</span>}
        {tag && <span className="inc">{tag}</span>}
        <span className="sr-only">, select driver</span>
      </button>
    </th>
  );
}

export function QualifyingTable({ view, phase, t, selected, onSelect }: Select & { view: StaticView; phase: QualifyingPhase; t: number }) {
  const body = useRef<HTMLTableSectionElement>(null);
  useRowFlip(body, `${phase.phase}:${phase.rows.map((r) => r.driver).join(",")}:${phase.noTime.join(",")}`, t);
  return (
    <div className="scroll" tabIndex={0} role="region" aria-label={`Qualifying sector times, Q${phase.phase}`}>
      <table className="timing quali">
        <caption className="sr-only">Qualifying sector times, Q{phase.phase}</caption>
        <thead>
          <tr>
            <th scope="col" className="left">P</th>
            <th scope="col" className="left">Driver</th>
            <th scope="col">S1</th><th scope="col">S2</th><th scope="col">S3</th>
            <th scope="col">Lap</th><th scope="col">Gap</th>
          </tr>
        </thead>
        <tbody ref={body}>
          {phase.rows.map((row) => (
            <tr key={row.driver} data-key={row.driver} className={`${row.driver === selected ? "sel" : ""} ${phase.cutAfter === row.position ? "cut" : ""}`}>
              <td className="num left muted">{row.position}</td>
              <DriverCell view={view} driver={row.driver} selected={selected} onSelect={onSelect} showName />
              {row.sectors.map((s, i) => <td key={i}><Time value={s} mark={row.marks[i]} /></td>)}
              <td className="num" style={{ fontWeight: 600 }}>{formatLapTime(row.lap)}</td>
              <td className="num muted">{row.position === 1 ? "—" : `+${row.gap.toFixed(3)}`}</td>
            </tr>
          ))}
          {phase.noTime.map((driver) => (
            <tr key={driver} data-key={driver} className={driver === selected ? "sel" : ""}>
              <td className="num left muted">–</td>
              <DriverCell view={view} driver={driver} selected={selected} onSelect={onSelect} showName />
              <td colSpan={5} className="num muted">No valid time</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RaceTable({ view, rows, snapshot, selected, onSelect }: Select & { view: StaticView; rows: RaceRow[]; snapshot: Snapshot }) {
  const body = useRef<HTMLTableSectionElement>(null);
  useRowFlip(body, rows.map((r) => r.driver).join(","), snapshot.t);
  const tags = new Map<number, string>();
  for (const f of snapshot.flags) for (const c of f.stopped) if (!tags.has(c.driver) && c.role !== "elsewhere") tags.set(c.driver, c.role === "contact" ? "CONTACT?" : c.role === "named" ? "INVOLVED" : "STOPPED");
  return (
    <div className="scroll" tabIndex={0} role="region" aria-label="Race order and splits">
      <table className="timing race">
        <caption className="sr-only">Race order, gaps and last-lap sector splits</caption>
        <thead>
          <tr>
            <th scope="col" className="left">P</th>
            <th scope="col" className="left">Driver</th>
            <th scope="col">Gap</th><th scope="col">Int</th>
            <th scope="col">S1</th><th scope="col">S2</th><th scope="col">S3</th>
            <th scope="col">Last lap</th>
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((row) => (
            <tr key={row.driver} data-key={row.driver} className={row.driver === selected ? "sel" : ""}>
              <td className="num left muted">{row.position}</td>
              <DriverCell view={view} driver={row.driver} selected={selected} onSelect={onSelect} tag={tags.get(row.driver)} />
              {/* 2026 data sends 0 rather than null for the leader, so the leader is taken from the order. */}
              <td className="num">{row.position === 1 ? "Leader" : row.gap ? formatGap(row.gap) : "–"}</td>
              <td className="num muted">{row.position === 1 ? "—" : row.interval ? formatGap(row.interval) : "–"}</td>
              {row.sectors.map((s, i) => <td key={i}><Time value={s} mark={row.marks[i]} /></td>)}
              <td className="num" style={{ fontWeight: 600 }}>
                {formatLapTime(row.lapTime)}
                {row.lapNumber !== null && row.lapNumber !== snapshot.lap - 1 && <span className="muted" style={{ fontWeight: 500 }}> L{row.lapNumber}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
