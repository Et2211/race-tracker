/** Tyre compounds as F1 shows them: names, and the colours of the sidewall markings. */
export const COMPOUND_NAME: Record<string, string> = { SOFT: "Softs", MEDIUM: "Mediums", HARD: "Hards", INTERMEDIATE: "Inters", WET: "Wets" };
export const COMPOUND_COLOUR: Record<string, string> = { SOFT: "#ff3b30", MEDIUM: "#ffd60a", HARD: "#e8eaed", INTERMEDIATE: "#2fd07a", WET: "#38bdf8" };
export const compoundName = (c: string | null) => (c ? (COMPOUND_NAME[c] ?? c) : "?");
export const compoundColour = (c: string | null) => (c ? (COMPOUND_COLOUR[c] ?? "var(--muted)") : "var(--border-strong)");
