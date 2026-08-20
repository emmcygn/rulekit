import { describe, it, expect } from "vitest";
import { sortReviewQueue, highlightSpan } from "../src/sort.js";
import type { ProposedFactCard } from "../src/types.js";

const card = (over: Partial<ProposedFactCard> & { id: string }): ProposedFactCard => ({
  patient: "SYN-042",
  fact: "nyha_class",
  value: "III",
  confidence: 0.9,
  doc: "echo-2026-03-12",
  quote: "NYHA class III",
  noteContext: "symptoms consistent with NYHA class III heart failure",
  flipsVerdict: false,
  ...over,
});

describe("sortReviewQueue — impact first, then ascending confidence", () => {
  it("puts a verdict-flipping fact ahead of a non-flipping one", () => {
    const out = sortReviewQueue([card({ id: "quiet", flipsVerdict: false }), card({ id: "loud", flipsVerdict: true })]);
    expect(out.map((c) => c.id)).toEqual(["loud", "quiet"]);
  });

  it("puts a low-confidence flipping fact ahead of a near-certain quiet one", () => {
    const out = sortReviewQueue([
      card({ id: "certain-quiet", confidence: 0.99, flipsVerdict: false }),
      card({ id: "unsure-loud", confidence: 0.55, flipsVerdict: true }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["unsure-loud", "certain-quiet"]);
  });

  it("sorts confidence ASCENDING within the impact group", () => {
    const out = sortReviewQueue([
      card({ id: "c", confidence: 0.95 }),
      card({ id: "a", confidence: 0.55 }),
      card({ id: "b", confidence: 0.72 }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts both groups ascending, impact group entirely first", () => {
    const out = sortReviewQueue([
      card({ id: "q-hi", confidence: 0.98, flipsVerdict: false }),
      card({ id: "i-hi", confidence: 0.97, flipsVerdict: true }),
      card({ id: "q-lo", confidence: 0.51, flipsVerdict: false }),
      card({ id: "i-lo", confidence: 0.6, flipsVerdict: true }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["i-lo", "i-hi", "q-lo", "q-hi"]);
  });

  it("breaks ties on id so the order is total and stable", () => {
    const a = sortReviewQueue([card({ id: "b", confidence: 0.9 }), card({ id: "a", confidence: 0.9 })]);
    const b = sortReviewQueue([card({ id: "a", confidence: 0.9 }), card({ id: "b", confidence: 0.9 })]);
    expect(a.map((c) => c.id)).toEqual(["a", "b"]);
    expect(b.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [card({ id: "z", confidence: 0.9 }), card({ id: "a", confidence: 0.1 })];
    const before = input.map((c) => c.id);
    sortReviewQueue(input);
    expect(input.map((c) => c.id)).toEqual(before);
  });

  it("handles an empty queue", () => {
    expect(sortReviewQueue([])).toEqual([]);
  });
});

describe("highlightSpan", () => {
  it("splits around the quote", () => {
    expect(highlightSpan("aaa QUOTE bbb", "QUOTE")).toEqual({ before: "aaa ", match: "QUOTE", after: " bbb" });
  });

  it("matches a quote spanning a newline after normalization", () => {
    expect(highlightSpan("one\r\ntwo", "one\ntwo")?.match).toBe("one\ntwo");
  });

  it("returns null when the quote no longer resolves", () => {
    expect(highlightSpan("aaa bbb", "ccc")).toBeNull();
  });

  it("returns null for the empty quote rather than matching at position 0", () => {
    expect(highlightSpan("aaa", "")).toBeNull();
  });

  it("does not fuzzy-match — case and spacing count, same as the gate", () => {
    expect(highlightSpan("LVEF 32%", "lvef 32%")).toBeNull();
    expect(highlightSpan("LVEF 32%", "LVEF  32%")).toBeNull();
  });
});
