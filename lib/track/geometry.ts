// Track geometry in OpenF1 location units (decimetres, arbitrary origin).

export type Point = { x: number; y: number };
export type TimedPoint = Point & { t: number };
export type OutlinePoint = Point & { s: number };

/** A closed lap line with cumulative arc length `s` and the two timing-sector boundaries. */
export type Outline = { points: OutlinePoint[]; length: number; s1: number; s2: number };

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Linear interpolation of a time-sorted trace. Null outside the trace or across a gap longer than `maxGapMs`. */
export function positionAt(trace: TimedPoint[], t: number, maxGapMs = 2000): TimedPoint | null {
  if (trace.length === 0 || t < trace[0].t || t > trace[trace.length - 1].t) return null;
  let lo = 0;
  let hi = trace.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = trace[lo];
  const b = trace[hi];
  if (b.t - a.t > maxGapMs) return null;
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/**
 * Build the outline from one car's trace over one lap. The sector boundaries are where
 * that car was when its sector 1 and sector 2 times elapsed.
 */
export function buildOutline(
  trace: TimedPoint[],
  lapStart: number,
  sector1: number,
  sector2: number,
  lapDuration: number,
): Outline {
  const lapEnd = lapStart + lapDuration * 1000;
  const first = positionAt(trace, lapStart);
  const last = positionAt(trace, lapEnd);
  if (!first || !last) throw new Error("Trace does not cover the whole lap");
  const raw = [first, ...trace.filter((p) => p.t > lapStart && p.t < lapEnd), last];
  const timed: (OutlinePoint & { t: number })[] = [];
  let s = 0;
  raw.forEach((p, i) => {
    if (i > 0) s += distance(raw[i - 1], p);
    timed.push({ x: p.x, y: p.y, s, t: p.t });
  });
  const arcAt = (t: number) => {
    for (let i = 1; i < timed.length; i++) {
      if (timed[i].t >= t) {
        const a = timed[i - 1];
        const b = timed[i];
        return a.s + ((t - a.t) / (b.t - a.t || 1)) * (b.s - a.s);
      }
    }
    return s;
  };
  return {
    points: timed.map(({ x, y, s }) => ({ x, y, s })),
    length: s,
    s1: arcAt(lapStart + sector1 * 1000),
    s2: arcAt(lapStart + (sector1 + sector2) * 1000),
  };
}

/** Nearest point on the outline: arc position `s` and lateral distance `offset`. */
export function project(outline: Outline, p: Point): { s: number; offset: number } {
  let best = { s: 0, offset: Infinity };
  const pts = outline.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const f = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const offset = Math.hypot(p.x - (a.x + f * vx), p.y - (a.y + f * vy));
    if (offset < best.offset) best = { s: a.s + f * (b.s - a.s), offset };
  }
  return best;
}

/** Point and unit tangent at arc position `s` (wraps around the lap). */
export function pointAt(outline: Outline, s: number): Point & { tx: number; ty: number } {
  const pts = outline.points;
  const target = ((s % outline.length) + outline.length) % outline.length;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].s >= target) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = b.s - a.s || 1;
      const f = (target - a.s) / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: (b.x - a.x) / seg, ty: (b.y - a.y) / seg };
    }
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const seg = b.s - a.s || 1;
  return { x: b.x, y: b.y, tx: (b.x - a.x) / seg, ty: (b.y - a.y) / seg };
}

/** Outline points between two arc positions, end points interpolated. Wraps when `from > to`. */
export function slice(outline: Outline, from: number, to: number): Point[] {
  if (from > to) return [...slice(outline, from, outline.length), ...slice(outline, 0, to)];
  const inner = outline.points.filter((p) => p.s > from && p.s < to);
  return [pointAt(outline, from), ...inner, pointAt(outline, Math.min(to, outline.length))].map(({ x, y }) => ({ x, y }));
}

export type Sector = 1 | 2 | 3;
export const sectorAt = (outline: Outline, s: number): Sector => (s < outline.s1 ? 1 : s < outline.s2 ? 2 : 3);
