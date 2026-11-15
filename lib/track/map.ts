import { pointAt, slice, type Outline, type Point } from "./geometry";

export const MAP_WIDTH = 600;
export const MAP_HEIGHT = 410;
const PADDING = 46;

export type MapTransform = { cos: number; sin: number; scale: number; minX: number; maxY: number; offsetX: number; offsetY: number };

const rotatePoint = (p: Point, cos: number, sin: number): Point => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });

/**
 * Fit the outline into the map box. With a display rotation from circuit data (degrees,
 * counter-clockwise, as FastF1 applies MultiViewer's `rotation`) the map matches the usual TV
 * orientation; without one, the longer side is laid horizontally. Y is flipped for SVG.
 */
export function fitOutline(outline: Outline, rotationDegrees: number | null = null): MapTransform {
  let angle = 0;
  if (rotationDegrees !== null) {
    angle = (rotationDegrees * Math.PI) / 180;
  } else {
    const xs = outline.points.map((p) => p.x);
    const ys = outline.points.map((p) => p.y);
    if (Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs)) angle = Math.PI / 2;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pts = outline.points.map((p) => rotatePoint(p, cos, sin));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const scale = Math.min((MAP_WIDTH - 2 * PADDING) / (maxX - minX), (MAP_HEIGHT - 2 * PADDING) / (maxY - minY));
  return {
    cos,
    sin,
    scale,
    minX,
    maxY,
    offsetX: (MAP_WIDTH - (maxX - minX) * scale) / 2,
    offsetY: (MAP_HEIGHT - (maxY - minY) * scale) / 2,
  };
}

export function toMap(t: MapTransform, p: Point): Point {
  const q = rotatePoint(p, t.cos, t.sin);
  return { x: round((q.x - t.minX) * t.scale + t.offsetX), y: round((t.maxY - q.y) * t.scale + t.offsetY) };
}

const round = (n: number) => Math.round(n * 10) / 10;

export const toPath = (points: Point[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");

/** SVG path for the stretch of track between two arc positions. */
export function stretchPath(outline: Outline, t: MapTransform, from: number, to: number): string {
  return toPath(slice(outline, from, to).map((p) => toMap(t, p)));
}

/** A point on the track in map space with the unit normal pointing away from the map centre. */
export function mapPointAt(outline: Outline, t: MapTransform, s: number): Point & { nx: number; ny: number } {
  const at = pointAt(outline, s);
  const p = toMap(t, at);
  const ahead = toMap(t, { x: at.x + at.tx * 100, y: at.y + at.ty * 100 });
  const len = Math.hypot(ahead.x - p.x, ahead.y - p.y) || 1;
  let nx = -(ahead.y - p.y) / len;
  let ny = (ahead.x - p.x) / len;
  if (nx * (p.x - MAP_WIDTH / 2) + ny * (p.y - MAP_HEIGHT / 2) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { ...p, nx, ny };
}
