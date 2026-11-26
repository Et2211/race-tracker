/**
 * The app's mark: a real speed trace. George Russell's lap 49 of the 2026 Spanish Grand Prix at
 * Madring, the race's fastest lap, from the recorded fixtures (car_data.outline-lap-63-49): speed
 * in km/h every 25 m along the lap, with distance from speed integrated over time.
 */
export const SPEED_TRACE: readonly number[] = [
  247, 258, 267, 276, 283, 287, 290, 295, 299, 302, 304, 306, 300, 272, 222, 176, 141, 121, 112, 103, 116, 142, 167, 193,
  207, 224, 234, 244, 253, 262, 273, 280, 285, 294, 297, 302, 307, 311, 313, 316, 319, 321, 323, 325, 326, 327, 329, 329,
  327, 323, 322, 318, 315, 312, 309, 298, 264, 218, 179, 138, 120, 117, 125, 146, 170, 188, 202, 212, 221, 226, 229, 225,
  203, 149, 108, 86, 91, 114, 130, 147, 176, 191, 202, 209, 216, 223, 226, 223, 220, 217, 214, 208, 202, 200, 207, 215,
  220, 231, 234, 230, 228, 227, 227, 232, 236, 244, 245, 254, 258, 261, 263, 265, 267, 268, 268, 268, 269, 271, 271, 271,
  272, 273, 273, 272, 270, 268, 215, 190, 159, 146, 144, 156, 171, 194, 208, 219, 228, 233, 239, 243, 252, 257, 259, 262,
  260, 259, 259, 258, 258, 257, 257, 257, 250, 218, 189, 147, 111, 100, 113, 145, 169, 187, 203, 212, 218, 214, 210, 209,
  212, 216, 224, 225, 223, 217, 215, 216, 225, 230, 234, 238, 242, 244, 246, 246, 233, 178, 138, 95, 75, 93, 126, 147,
  143, 125, 117, 130, 149, 172, 195, 206, 208, 218, 225, 193, 158, 138, 131, 138, 156, 180, 188, 200, 227,
];

/** An SVG path of the trace filling `width` x `height`, `pad` from the top and bottom. */
export function tracePath(width: number, height: number, pad = 0, trace: readonly number[] = SPEED_TRACE): string {
  const lo = Math.min(...trace);
  const hi = Math.max(...trace);
  const x = (i: number) => (i / (trace.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad);
  return trace.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
}
