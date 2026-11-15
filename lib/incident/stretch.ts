import type { SessionMeta } from "@/lib/session/types";
import { placeMarshalSector } from "@/lib/track/markers";

const MARGIN = 300; // decimetres: positions are approximate and the markers hand-drawn

function within(x: number, a: number, b: number, length: number) {
  const from = ((a % length) + length) % length;
  const to = ((b % length) + length) % length;
  return from <= to ? x >= from && x <= to : x >= from || x <= to;
}

/**
 * The flagged stretch along the lap: from the start of the lowest flagged sector (the warning
 * sector) to the end of the incident sector, plus a margin. Null when the sector cannot be placed.
 */
export function flaggedStretch(meta: SessionMeta, sector: number, sectors: number[]): [number, number] | null {
  if (!meta.outline) return null;
  const placed = placeMarshalSector(meta.marshal, meta.outline, sector);
  if (placed.kind !== "stretch") return null;
  let from = placed.from;
  const lowest = Math.min(...sectors);
  if (meta.marshal.source === "multiviewer" && meta.marshal.starts[lowest] !== undefined) from = meta.marshal.starts[lowest];
  return [from - MARGIN, placed.to + MARGIN];
}

/** Split stops into those inside the flagged stretch and those elsewhere. Without a stretch, all count as inside. */
export function splitByStretch<T extends { arc: number }>(meta: SessionMeta, stretch: [number, number] | null, cars: T[]) {
  if (!stretch || !meta.outline) return { here: cars, elsewhere: [] as T[] };
  const L = meta.outline.length;
  return { here: cars.filter((c) => within(c.arc, stretch[0], stretch[1], L)), elsewhere: cars.filter((c) => !within(c.arc, stretch[0], stretch[1], L)) };
}
