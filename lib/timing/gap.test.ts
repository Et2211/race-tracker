import { describe, expect, it } from "vitest";
import { formatGap, parseGap } from "./gap";

describe("parseGap", () => {
  it("treats null and undefined as the leader", () => {
    expect(parseGap(null)).toEqual({ kind: "leader" });
    expect(parseGap(undefined)).toEqual({ kind: "leader" });
  });

  it("keeps numeric seconds, including zero", () => {
    expect(parseGap(41.019)).toEqual({ kind: "time", seconds: 41.019 });
    expect(parseGap(0)).toEqual({ kind: "time", seconds: 0 });
  });

  it("parses lapped-car strings in singular and plural", () => {
    expect(parseGap("+1 LAP")).toEqual({ kind: "laps", laps: 1 });
    expect(parseGap("+3 LAPS")).toEqual({ kind: "laps", laps: 3 });
  });

  it("parses numeric strings", () => {
    expect(parseGap("+2.345")).toEqual({ kind: "time", seconds: 2.345 });
  });

  it("does not coerce unexpected text", () => {
    expect(parseGap("DNF")).toEqual({ kind: "unknown", raw: "DNF" });
    expect(parseGap("")).toEqual({ kind: "unknown", raw: "" });
    expect(parseGap(Number.NaN)).toEqual({ kind: "unknown", raw: "NaN" });
  });
});

describe("formatGap", () => {
  it("formats each kind", () => {
    expect(formatGap({ kind: "leader" })).toBe("Leader");
    expect(formatGap({ kind: "time", seconds: 2.8 })).toBe("+2.800");
    expect(formatGap({ kind: "laps", laps: 1 })).toBe("+1 LAP");
    expect(formatGap({ kind: "laps", laps: 2 })).toBe("+2 LAPS");
  });
});
