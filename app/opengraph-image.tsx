import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { tracePath } from "@/lib/brand/speed-trace";

// The picture a shared link shows (X, messaging apps). Built once, at build time.
export const alt = "Speed Trace: a red speed trace of a lap across a dark background, under the name Speed Trace.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));
const [bold, semibold] = await Promise.all([font("BarlowCondensed-Bold.ttf"), font("BarlowCondensed-SemiBold.ttf")]);

export default function Image() {
  const trace = { width: 1200, height: 250 };
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0e1014", color: "#e8eaed", fontFamily: "Barlow Condensed" }}>
        <div style={{ display: "flex", flexDirection: "column", padding: "64px 72px 0" }}>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: 3, color: "#ff4b3e", textTransform: "uppercase" }}>Live timing · Replays · Telemetry</div>
          <div style={{ fontSize: 150, fontWeight: 700, lineHeight: 1, marginTop: 8 }}>SPEED TRACE</div>
          <div style={{ fontSize: 40, fontWeight: 600, color: "#9aa3b2", marginTop: 16 }}>Every session on a live track map, with gaps, flags and driver telemetry.</div>
        </div>
        <div style={{ display: "flex", marginTop: "auto" }}>
          <svg width={trace.width} height={trace.height} viewBox={`0 0 ${trace.width} ${trace.height}`}>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={0} x2={trace.width} y1={trace.height * f} y2={trace.height * f} stroke="#262c37" strokeWidth={2} />
            ))}
            <path d={tracePath(trace.width, trace.height, 24)} fill="none" stroke="#e10600" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Barlow Condensed", data: bold, weight: 700, style: "normal" },
        { name: "Barlow Condensed", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}
