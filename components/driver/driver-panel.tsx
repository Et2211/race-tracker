"use client";

import { useMemo, useState } from "react";
import type { StaticView } from "@/lib/dashboard/snapshot";
import { passes } from "@/lib/driver/passes";
import { driverSummary } from "@/lib/driver/summary";
import type { SessionMeta } from "@/lib/session/types";
import { SummaryTab } from "./summary-tab";

type TabId = "summary";
const TABS: { id: TabId; label: string }[] = [{ id: "summary", label: "Summary" }];

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
  const [tab, setTab] = useState<TabId>("summary");
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
          {TABS.length > 1 && (
            <div role="group" aria-label="Driver focus view" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TABS.map((x) => (
                <button key={x.id} className="tab" aria-pressed={x.id === tab} onClick={() => setTab(x.id)}>{x.label}</button>
              ))}
            </div>
          )}
          {tab === "summary" && <SummaryTab summary={summary} driver={selected} view={view} laps={meta.laps} kind={meta.kind} live={live} />}
        </>
      )}
    </section>
  );
}
