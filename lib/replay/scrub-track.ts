/**
 * The scrubber's track as a CSS gradient: what is played so far (red) and what car data is loaded
 * (lighter) or still to come (darker), along the span [start, end). Colours are CSS variables
 * (see .scrubber in globals.css), so the theme decides them.
 */
export function scrubTrack(ranges: [number, number][], start: number, end: number, t: number): string {
  const len = end - start;
  if (len <= 0) return "var(--scrub-empty)";
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / len) * 100));
  const played = pct(t);
  // Every place the colour may change, in order.
  const cuts = new Set<number>([0, 100, played]);
  for (const [a, b] of ranges) {
    cuts.add(pct(a));
    cuts.add(pct(b));
  }
  const xs = [...cuts].sort((a, b) => a - b);
  const loadedAt = (x: number) => ranges.some(([a, b]) => x >= pct(a) && x < pct(b));
  const stops: string[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const [a, b] = [xs[i], xs[i + 1]];
    if (b <= a) continue;
    const mid = (a + b) / 2;
    const colour = mid < played ? (loadedAt(mid) ? "var(--scrub-played)" : "var(--scrub-played-empty)") : loadedAt(mid) ? "var(--scrub-loaded)" : "var(--scrub-empty)";
    const prev = stops.at(-1);
    // Merge with the previous stretch when the colour does not change.
    if (prev?.startsWith(colour + " ")) stops[stops.length - 1] = `${colour} ${prev.split(" ")[1]} ${round(b)}%`;
    else stops.push(`${colour} ${round(a)}% ${round(b)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

const round = (x: number) => Math.round(x * 100) / 100;
