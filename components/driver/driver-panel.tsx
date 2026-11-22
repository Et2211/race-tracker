"use client";

import { useMemo, useState } from "react";
import type { StaticView } from "@/lib/dashboard/snapshot";
import { gapStory, lineCrossings } from "@/lib/driver/gaps";
import { driverPace, neutralisedPeriods } from "@/lib/driver/pace";
import { passes } from "@/lib/driver/passes";
import { driverSummary, lapAt } from "@/lib/driver/summary";
import { passingAid } from "@/lib/timing/battles";
import type { SessionMeta } from "@/lib/session/types";
import { GapsTab, type GapEvent } from "./gaps-tab";
import { PaceTab } from "./pace-tab";
import { SummaryTab } from "./summary-tab";

type TabId = "summary" | "pace" | "gaps";
const TABS: { id: TabId; label: string; races?: true }[] = [
  { id: "summary", label: "Summary" },
  { id: "pace", label: "Race pace", races: true },
  { id: "gaps", label: "Gaps", races: true },
];

/** Each driver's place at `t`, from the position feed. */
function orderAt(meta: SessionMeta, t: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of meta.positions) {
    if (Date.parse(r.date) > t) break;
    out.set(r.driver_number, r.position);
  }
  return out;
}

/** Lights out for a race, the session start otherwise. */
const startOf = (meta: SessionMeta) => {
  const started = meta.raceControl.find((r) => r.message === "SESSION STARTED");
  return started ? Date.parse(started.date) : meta.span.start;
};

/**
 * A deep dive into the selected driver's session so far. Everything is worked out from the session
 * data up to the replay time `t`, so a replay never shows what is still to come and a live session
 * fills in as it runs.
 */
export function DriverPanel({ meta, view, selected, t, live }: { meta: SessionMeta; view: StaticView; selected: number | null; t: number; live: boolean }) {
  const [tabChoice, setTab] = useState<TabId>("summary");
  const [rivalChoice, setRival] = useState<number | null>(null);
  const tabs = TABS.filter((x) => !x.races || meta.kind === "race");
  const tab = tabs.some((x) => x.id === tabChoice) ? tabChoice : "summary";
  const start = startOf(meta);
  const allPasses = useMemo(() => (meta.kind === "race" ? passes(meta.positions, meta.pits, meta.laps, meta.results, start) : []), [meta.kind, meta.positions, meta.pits, meta.laps, meta.results, start]);
  const summary = useMemo(
    () =>
      selected === null
        ? null
        : driverSummary({ kind: meta.kind, laps: meta.laps, raceControl: meta.raceControl, positions: meta.positions, pits: meta.pits, stints: meta.stints ?? null, passes: allPasses, start, live }, selected, t),
    [meta, selected, t, allPasses, start, live],
  );
  const d = selected !== null ? view.drivers[selected] : null;

  // Race pace: the selected driver against a rival, by default the car ahead (or behind, for the leader).
  const neutral = useMemo(() => neutralisedPeriods(meta.raceControl), [meta.raceControl]);
  const order = useMemo(() => (tab === "pace" ? orderAt(meta, t) : new Map<number, number>()), [tab, meta, t]);
  const rivals = useMemo(() => [...order.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n).filter((n) => n !== selected), [order, selected]);
  const mine = selected !== null ? order.get(selected) : undefined;
  const byPlace = (p: number | undefined) => [...order.entries()].find(([, pos]) => pos === p)?.[0];
  const rival = rivalChoice !== null && rivalChoice !== selected && order.has(rivalChoice) ? rivalChoice : mine === undefined ? (rivals[0] ?? null) : (byPlace(mine === 1 ? 2 : mine - 1) ?? rivals[0] ?? null);
  const pace = useMemo(() => {
    if (tab !== "pace" || selected === null) return null;
    const of = (driver: number) => ({ driver, ...driverPace(meta.laps, meta.stints ?? null, meta.raceControl, meta.pits, neutral, driver, t) });
    return { main: of(selected), rival: rival !== null ? of(rival) : null };
  }, [tab, selected, rival, meta, neutral, t]);

  // Gaps: at the line, lap by lap, with the driver's stops and passes on track marked.
  const crossings = useMemo(() => (meta.kind === "race" ? lineCrossings(meta.laps) : new Map()), [meta.kind, meta.laps]);
  const gaps = useMemo(() => {
    if (tab !== "gaps" || selected === null) return null;
    const story = gapStory(crossings, selected, t);
    const events: GapEvent[] = [
      ...meta.pits.filter((p) => p.driver_number === selected && Date.parse(p.date) <= t).map((p) => ({ lap: p.lap_number, kind: "pit" as const, other: null })),
      ...allPasses
        .filter((p) => p.t <= t && p.kind === "track" && (p.by === selected || p.of === selected))
        .map((p) => ({ lap: lapAt(meta.laps, selected, p.t) ?? 0, kind: p.by === selected ? ("gained" as const) : ("lost" as const), other: p.by === selected ? p.of : p.by })),
    ];
    const neutralLaps = new Set(
      meta.laps
        .filter((l) => l.driver_number === selected && l.date_start && l.lap_duration !== null)
        .filter((l) => {
          const a = Date.parse(l.date_start!);
          return neutral.some(([from, to]) => a < to && a + l.lap_duration! * 1000 > from);
        })
        .map((l) => l.lap_number),
    );
    return { story, events, neutralLaps };
  }, [tab, selected, crossings, t, meta.pits, meta.laps, allPasses, neutral]);

  return (
    <section className="panel col-driver" id="driver-focus" aria-labelledby="driver-focus-title">
      <div className="split">
        <h2 id="driver-focus-title">Driver focus</h2>
        {d && (
          <div className="driver-name">
            <span className="bar" style={{ background: d.colour }} aria-hidden="true" />
            <strong>#{d.number} {d.code}</strong> <span className="muted">{d.name}{d.team ? ` · ${d.team}` : ""}</span>
          </div>
        )}
      </div>
      {selected === null || !summary ? (
        <p className="note">Pick a driver on the map or in a timing table to see their session in detail.</p>
      ) : (
        <>
          {tabs.length > 1 && (
            <div role="group" aria-label="Driver focus view" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {tabs.map((x) => (
                <button key={x.id} className="tab" aria-pressed={x.id === tab} onClick={() => setTab(x.id)}>{x.label}</button>
              ))}
            </div>
          )}
          {tab === "summary" && <SummaryTab summary={summary} driver={selected} view={view} laps={meta.laps} kind={meta.kind} live={live} />}
          {tab === "pace" && pace && <PaceTab main={pace.main} rival={pace.rival} rivals={rivals} onRival={setRival} view={view} />}
          {tab === "gaps" && gaps && <GapsTab gaps={gaps.story} events={gaps.events} neutralLaps={gaps.neutralLaps} view={view} aid={passingAid(meta.session.year)} />}
        </>
      )}
    </section>
  );
}
