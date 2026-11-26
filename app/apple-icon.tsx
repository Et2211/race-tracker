import { ImageResponse } from "next/og";
import { mark } from "./icon";

// Home-screen icon on iPhones and iPads.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(mark(size.width), size);
}
