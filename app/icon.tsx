import { ImageResponse } from "next/og";
import { SPEED_TRACE, tracePath } from "@/lib/brand/speed-trace";

// The browser-tab icon: the first stretch of the speed trace (a straight, a hard stop, the exit) in red.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export function mark(px: number) {
  const inset = px * 0.16;
  const w = px - 2 * inset;
  const stroke = Math.max(2, px * 0.085);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0e1014", borderRadius: px * 0.22 }}>
      <svg width={w} height={w} viewBox={`0 0 ${w} ${w}`}>
        <path d={tracePath(w, w, stroke, SPEED_TRACE.slice(0, 30))} fill="none" stroke="#e10600" strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function Icon() {
  return new ImageResponse(mark(size.width), size);
}
