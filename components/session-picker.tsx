"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { FIRST_YEAR, type Catalog } from "@/lib/session/catalog";

/** "Sat 22 Nov, 04:00 UTC". UTC so the server and every viewer agree. */
const formatWhen = (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `${day}, ${d.toISOString().slice(11, 16)} UTC`;
};

/** Season, then Grand Prix, then session. Navigates to the chosen session. */
export function SessionPicker({ label, current }: { label: string; current?: { year: number; meetingKey: number; sessionKey: number } }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(!current);
  const [years, setYears] = useState<number[] | null>(null);
  const [chosenYear, setYear] = useState<number | null>(current?.year ?? null);
  const year = chosenYear ?? years?.[0] ?? null;
  const [catalogs, setCatalogs] = useState<Record<number, Catalog>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const catalog = year !== null ? (catalogs[year] ?? null) : null;
  const error = year !== null ? (errors[year] ?? null) : null;

  useEffect(() => {
    if (!open || years) return;
    let cancelled = false;
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((body: { years: number[] }) => !cancelled && setYears(body.years))
      .catch(() => !cancelled && setYears(current ? [current.year] : [FIRST_YEAR]));
    return () => {
      cancelled = true;
    };
  }, [open, years, current]);
  const [meetingKey, setMeetingKey] = useState<number | null>(current?.meetingKey ?? null);
  const [sessionKey, setSessionKey] = useState<number | null>(current?.sessionKey ?? null);

  useEffect(() => {
    if (!open || year === null || catalogs[year]) return;
    let cancelled = false;
    fetch(`/api/catalog/${year}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        if (!cancelled) setCatalogs((c) => ({ ...c, [year]: body as Catalog }));
      })
      .catch((e: unknown) => {
        if (!cancelled) setErrors((x) => ({ ...x, [year]: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [year, open, catalogs]);

  const meeting = catalog?.meetings.find((m) => m.meetingKey === meetingKey) ?? null;
  const session = meeting?.sessions.find((s) => s.sessionKey === sessionKey) ?? null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <button className="picker" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((o) => !o)}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={`${id}-panel`} role="group" aria-label="Choose a session" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label className="sr-only" htmlFor={`${id}-year`}>Season</label>
          <select id={`${id}-year`} className="picker" value={year ?? ""} disabled={!years} onChange={(e) => { setYear(Number(e.target.value)); setMeetingKey(null); setSessionKey(null); }}>
            {!years && <option value="">Loading…</option>}
            {(years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <label className="sr-only" htmlFor={`${id}-meeting`}>Grand Prix</label>
          <select id={`${id}-meeting`} className="picker" value={meetingKey ?? ""} disabled={!catalog} onChange={(e) => { setMeetingKey(Number(e.target.value)); setSessionKey(null); }}>
            <option value="" disabled>{catalog ? "Grand Prix" : error ? "Could not load" : "Loading…"}</option>
            {catalog?.meetings.map((m) => <option key={m.meetingKey} value={m.meetingKey}>{m.name} · {m.circuit}</option>)}
          </select>
          <label className="sr-only" htmlFor={`${id}-session`}>Session</label>
          <select id={`${id}-session`} className="picker" value={sessionKey ?? ""} disabled={!meeting} onChange={(e) => setSessionKey(Number(e.target.value))}>
            <option value="" disabled>Session</option>
            {meeting?.sessions.map((s) => (
              <option key={s.sessionKey} value={s.sessionKey} disabled={!s.available}>
                {s.name}
                {s.upcoming
                  ? ` · not run yet, ${formatWhen(s.dateStart)}`
                  : !s.available
                    ? " · results not final yet"
                    : s.downloaded
                      ? " · downloaded"
                      : " · downloads in about 1½ min"}
              </option>
            ))}
          </select>
          <button className="seg" style={{ border: "1px solid var(--border-strong)", borderRadius: 8 }} disabled={!session?.available} onClick={() => session && router.push(`/session/${session.sessionKey}`)}>
            Open
          </button>
          {error && <span className="note" role="alert">Season list unavailable: {error}</span>}
          {catalog?.source === "fixtures" && <span className="note">Offline mode: only the recorded sessions are listed.</span>}
        </div>
      )}
    </div>
  );
}
