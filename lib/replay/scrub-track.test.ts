import { describe, expect, it } from "vitest";
import { scrubTrack } from "./scrub-track";

describe("scrubTrack", () => {
  it("colours played, loaded and missing stretches along the span", () => {
    // Span 0–100 s; loaded 0–40 s and 60–80 s; playhead at 20 s.
    expect(scrubTrack([[0, 40_000], [60_000, 80_000]], 0, 100_000, 20_000)).toBe(
      "linear-gradient(to right, var(--scrub-played) 0% 20%, var(--scrub-loaded) 20% 40%, var(--scrub-empty) 40% 60%, var(--scrub-loaded) 60% 80%, var(--scrub-empty) 80% 100%)",
    );
  });
  it("shows played stretches without data in a dimmer red", () => {
    expect(scrubTrack([[50_000, 100_000]], 0, 100_000, 75_000)).toBe(
      "linear-gradient(to right, var(--scrub-played-empty) 0% 50%, var(--scrub-played) 50% 75%, var(--scrub-loaded) 75% 100%)",
    );
  });
  it("clips ranges outside the span, and copes with an empty one", () => {
    expect(scrubTrack([[-10_000, 200_000]], 0, 100_000, 0)).toBe("linear-gradient(to right, var(--scrub-loaded) 0% 100%)");
    expect(scrubTrack([], 5, 5, 5)).toBe("var(--scrub-empty)");
  });
});
