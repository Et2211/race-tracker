"use client";

import { useEffect, useMemo, useState } from "react";
import type { StaticView } from "@/lib/dashboard/snapshot";
import { compareCorners, cornersFromMultiViewer, cornersFromSpeed, type CircuitCorners, type CornerSet } from "@/lib/driver/corners";
import { gapStory, lineCrossings } from "@/lib/driver/gaps";
import { bestOption, lapOptions, officialOf, type LapOption } from "@/lib/driver/lap-compare";
import { lapTrace, type LapTrace } from "@/lib/driver/lap-trace";
import { driverPace, neutralisedPeriods } from "@/lib/driver/pace";
import { labelRetirements, passes } from "@/lib/driver/passes";
import { isRetiredAt, retirements } from "@/lib/incident/retired";
import { driverSummary, lapAt } from "@/lib/driver/summary";
import { passingAid } from "@/lib/timing/battles";
import { floorIndex, type TelemetryIndex } from "@/lib/session/telemetry";
import type { SessionMeta } from "@/lib/session/types";
import { CornersTab } from "./corners-tab";
import { GapsTab, type GapEvent } from "./gaps-tab";
import { LapCompareTab, type TraceState } from "./lap-compare-tab";
import { PaceTab } from "./pace-tab";
import { SummaryTab } from "./summary-tab";

type TabId = "summary" | "pace" | "gaps" | "laps" | "corners";
const TABS: { id: TabId; label: string; races?: true }[] = [
  { id: "summary", label: "Summary" },
  { id: "pace", label: "Race pace", races: true },
  { id: "gaps", label: "Gaps", races: true },
  { id: "laps", label: "Lap comparison" },
  { id: "corners", label: "Corners" },
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
export function DriverPanel({
  meta,
  view,
  selected,
  t,
  live,
  telemetry,
  version,
}: {
  meta: SessionMeta;
  view: StaticView;
  selected: number | null;
  t: number;
  live: boolean;
  telemetry: TelemetryIndex;
  /** Changes whenever more telemetry has loaded. */
  version: number;
}) {
  const [tabChoice, setTab] = useState<TabId>("summary");
  const [rivalChoice, setRival] = useState<number | null>(null);
  const tabs = TABS.filter((x) => !x.races || meta.kind === "race");
  const tab = tabs.some((x) => x.id === tabChoice) ? tabChoice : "summary";
  const start = startOf(meta);
  const rawPasses = useMemo(() => (meta.kind === "race" ? passes(meta.positions, meta.pits, start) : []), [meta.kind, meta.positions, meta.pits, start]);
  // Passes of a retiring car are labelled once the car has visibly stopped, as the map removes it.
  const finalLaps = useMemo(() => retirements(meta.results, meta.laps), [meta.results, meta.laps]);
  const allPasses = useMemo(
    () =>
      labelRetirements(rawPasses, t, {
        finalLapStart: (d) => finalLaps.get(d),
        stoppedBy: (d, at) => {
          const trace = telemetry.traces.get(d);
          return !!trace && isRetiredAt(trace, finalLaps.get(d)!, at);
        },
        speedAt: (d, at) => {
          const car = telemetry.cars.get(d);
          const i = car ? floorIndex(car.t, at) : -1;
          return car && i >= 0 && at - car.t[i] < 2000 ? car.speed[i] : null;
        },
      }),
    // `version` changes as telemetry loads into the same index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawPasses, t, finalLaps, telemetry, version],
  );
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

  // Lap comparison: the selected driver's lap (their best by default) against another (by default
  // the fastest lap so far by anyone else). Laps finish over time, so the list is rebuilt each second.
  const [lapAChoice, setLapA] = useState<LapOption | null>(null);
  const [lapBChoice, setLapB] = useState<LapOption | null>(null);
  const second = Math.floor(t / 1000);
  const lapsTab = tab === "laps" || tab === "corners";
  const options = useMemo(() => (lapsTab ? lapOptions(meta.laps, meta.raceControl, second * 1000) : []), [lapsTab, meta.laps, meta.raceControl, second]);
  const findOption = (o: LapOption | null) => (o ? (options.find((x) => x.driver === o.driver && x.lap === o.lap) ?? null) : null);
  // Live, only recent laps have car data loaded, so offer those first.
  const usable = meta.source === "live" ? options.filter((o) => telemetry.covers(o.start) && telemetry.covers(o.start + o.time * 1000)) : options;
  const lapA =
    (lapAChoice?.driver === selected ? findOption(lapAChoice) : null) ??
    (selected !== null ? (bestOption(usable, selected) ?? usable.filter((o) => o.driver === selected).at(-1) ?? bestOption(options, selected) ?? options.filter((o) => o.driver === selected).at(-1) ?? null) : null);
  const others = usable.filter((o) => o.driver !== selected);
  const lapB = findOption(lapBChoice) ?? bestOption(others) ?? others.at(-1) ?? bestOption(options.filter((o) => o.driver !== selected)) ?? null;
  const traces = useMemo(() => {
    const trace = (o: LapOption | null): TraceState | null => {
      if (!o) return null;
      if (!meta.outline) return { error: "There is no track outline for this session, so laps can't be placed along it." };
      const end = o.start + o.time * 1000;
      if (meta.source === "live") {
        // The live page holds the last two minutes of car data, plus wherever the viewer has
        // scrolled back to. A lap that has only just finished may still be arriving.
        if (!telemetry.covers(o.start)) return { error: "The live page only holds car data from the last couple of minutes and from where you have scrolled back to, so this lap can't be shown. Laps finished while you watch can be." };
        if (!telemetry.covers(end)) return "loading";
      } else {
        const needed = meta.windows.filter((w) => w.from < end && w.to > o.start);
        if (!needed.length) return { error: "No car data was recorded for this lap." };
        if (needed.some((w) => !telemetry.has(w.index))) return "loading";
      }
      const pos = telemetry.traces.get(o.driver);
      const car = telemetry.cars.get(o.driver);
      if (!pos || !car) return { error: "No car data for this lap." };
      return lapTrace(meta.outline, pos, car, o.driver, o.lap, o.start, officialOf(o));
    };
    return lapsTab ? { a: trace(lapA), b: trace(lapB) } : { a: null, b: null };
    // `version` changes as telemetry loads into the same index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lapsTab, lapA?.driver, lapA?.lap, lapB?.driver, lapB?.lap, meta.outline, meta.source, meta.windows, telemetry, version]);

  // Corners: the circuit's numbered turns (fetched once per session), else found from lap A's speed.
  const sessionKey = meta.session.session_key;
  const [circuit, setCircuit] = useState<{ key: number; data: CircuitCorners } | null>(null);
  useEffect(() => {
    if (!lapsTab || circuit?.key === sessionKey) return;
    let live = true;
    fetch(`/api/sessions/${sessionKey}/corners`)
      .then((r) => (r.ok ? (r.json() as Promise<CircuitCorners>) : { source: "none" as const }))
      .catch(() => ({ source: "none" as const }))
      .then((data) => live && setCircuit({ key: sessionKey, data }));
    return () => {
      live = false;
    };
  }, [lapsTab, sessionKey, circuit?.key]);
  const isTrace = (s: TraceState | null): s is LapTrace => !!s && s !== "loading" && !("error" in s);
  const cornerSet = useMemo((): CornerSet | null => {
    const data = circuit?.key === sessionKey ? circuit.data : null;
    if (data?.source === "multiviewer" && meta.outline) {
      const corners = cornersFromMultiViewer(meta.outline, data.corners);
      if (corners) return { source: "multiviewer", corners };
    }
    // Until the circuit's turns have arrived, don't flash corners found from the speed.
    if (!data) return null;
    return isTrace(traces.a) ? { source: "speed", corners: cornersFromSpeed(traces.a) } : null;
  }, [circuit, sessionKey, meta.outline, traces.a]);
  const cornerRows = useMemo(() => (tab === "corners" && cornerSet && isTrace(traces.a) ? compareCorners(cornerSet.corners, traces.a, isTrace(traces.b) ? traces.b : null) : null), [tab, cornerSet, traces]);

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
          {tab === "laps" && (
            <LapCompareTab
              options={options}
              driver={selected}
              a={lapA}
              b={lapB}
              onA={setLapA}
              onB={setLapB}
              traces={traces}
              sectors={meta.outline ? [meta.outline.s1 / 10, meta.outline.s2 / 10] : null}
              corners={cornerSet?.corners ?? null}
              view={view}
            />
          )}
          {tab === "corners" && (
            <CornersTab
              options={options}
              driver={selected}
              a={lapA}
              b={lapB}
              onA={setLapA}
              onB={setLapB}
              traces={traces}
              set={cornerSet}
              year={circuit?.data.source === "multiviewer" ? circuit.data.year : null}
              rows={cornerRows}
              view={view}
            />
          )}
          {tab === "gaps" && gaps && <GapsTab gaps={gaps.story} events={gaps.events} neutralLaps={gaps.neutralLaps} view={view} aid={passingAid(meta.session.year)} />}
        </>
      )}
    </section>
  );
}
