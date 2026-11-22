import { project, type Outline } from "./geometry";

/** Where each marshal sector starts along the lap, and how that was established. */
export type MarshalSectors =
  | {
      source: "multiviewer";
      /** Arc position (decimetres from the start line) of each marker, by sector number. */
      starts: Record<number, number>;
      count: number;
      /** The year MultiViewer drew the file for; it can predate the session. */
      dataYear: number | null;
    }
  | { source: "learned"; observations: Record<number, number[]>; count: number | null }
  | { source: "none" };

/** The parts of a MultiViewer circuit file this app reads. */
export type MultiViewerCircuit = {
  year?: number;
  rotation?: number;
  marshalSectors?: { number: number; trackPosition: { x: number; y: number } }[];
  /** Turns, numbered as on the official circuit map. */
  corners?: { number: number; trackPosition: { x: number; y: number } }[];
};

/** Markers further than this from the racing line are treated as not matching the outline. */
const MAX_MARKER_OFFSET = 300; // decimetres

/**
 * Project MultiViewer's marshal-sector markers onto our outline. The files share OpenF1's
 * coordinate frame (checked on Baku, Interlagos and Singapore, median 0.1 m). Returns null when the
 * markers do not fit this outline: too far off the line or not in lap order (layout changed).
 */
export function sectorsFromMultiViewer(outline: Outline, file: MultiViewerCircuit): MarshalSectors | null {
  const markers = [...(file.marshalSectors ?? [])].sort((a, b) => a.number - b.number);
  if (markers.length < 3) return null;
  const starts: Record<number, number> = {};
  const arcs: number[] = [];
  for (const m of markers) {
    const { s, offset } = project(outline, m.trackPosition);
    if (offset > MAX_MARKER_OFFSET) return null;
    starts[m.number] = s;
    arcs.push(s);
  }
  // In lap order, allowing one wrap past the start line (marker 1 often sits just before it).
  let wraps = 0;
  for (let i = 1; i < arcs.length; i++) if (arcs[i] < arcs[i - 1]) wraps++;
  if (arcs[arcs.length - 1] > arcs[0]) {
    if (wraps > 0) return null;
  } else if (wraps > 1) {
    return null;
  }
  return { source: "multiviewer", starts, count: markers.length, dataYear: file.year ?? null };
}

export type Placement =
  | { kind: "stretch"; from: number; to: number; basis: string }
  | { kind: "unknown"; reason: string };

/** Learned positions must agree within this distance to be drawn. */
const LEARNED_AGREEMENT = 1000; // decimetres
const LEARNED_MARGIN = 300;

export function placeMarshalSector(sectors: MarshalSectors, outline: Outline, sector: number): Placement {
  if (sectors.source === "multiviewer") {
    const from = sectors.starts[sector];
    const next = sectors.starts[sector + 1] ?? sectors.starts[1];
    if (from === undefined || next === undefined) {
      return { kind: "unknown", reason: `The circuit data has no marker for marshal sector ${sector}.` };
    }
    const year = sectors.dataYear ? ` (drawn for ${sectors.dataYear})` : "";
    return { kind: "stretch", from, to: next, basis: `Sector limits from MultiViewer circuit data${year}, which is hand-made and approximate.` };
  }
  if (sectors.source === "learned") {
    const seen = sectors.observations[sector] ?? [];
    if (seen.length >= 2) {
      const lo = Math.min(...seen);
      const hi = Math.max(...seen);
      if (hi - lo <= LEARNED_AGREEMENT) {
        return {
          kind: "stretch",
          from: Math.max(0, lo - LEARNED_MARGIN),
          to: Math.min(outline.length, hi + LEARNED_MARGIN),
          basis: `Estimated from where cars stopped under flags in this sector in ${seen.length} other sessions. The sector's real limits are not known.`,
        };
      }
    }
    return { kind: "unknown", reason: `Marshal sector ${sector} has not been located on this circuit yet.` };
  }
  return { kind: "unknown", reason: "No marshal-sector positions are available for this circuit." };
}
