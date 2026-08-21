/**
 * Note excerpting (uiux B2).
 *
 * The shipped queue rendered every card's whole note: 16,068px of content in an
 * 800px viewport, with the first Confirm button 276px below the fold. A card
 * shows the grounded quote with one sentence either side; the full note is one
 * click away.
 */
import { describe, expect, it } from "vitest";
import { excerptSpan, highlightSpan } from "../src/review/sort.js";
import { DEMO_FACTS, DEMO_NOTES } from "../src/data/index.js";

const NOTE = [
  "First sentence, well before anything relevant.",
  "Second sentence, still scene-setting.",
  "The lead-in sentence.",
  "Labs today show eGFR 62 mL/min/1.73m2 on a stable creatinine.",
  "The trailing sentence.",
  "A far later sentence nobody needs.",
  "Electronically signed by a fictional clinician.",
].join(" ");

describe("excerptSpan", () => {
  const quote = "eGFR 62 mL/min/1.73m2";

  it("keeps one sentence either side of the quote", () => {
    const span = excerptSpan(NOTE, quote, 1)!;
    expect(span.match).toBe(quote);
    expect(span.before).toContain("The lead-in sentence.");
    expect(span.before).not.toContain("scene-setting");
    expect(span.after).toContain("The trailing sentence.");
    expect(span.after).not.toContain("far later sentence");
    expect(span.truncated).toBe(true);
  });

  it("is a strict shortening of the full span — same quote, same order", () => {
    const full = highlightSpan(NOTE, quote)!;
    const span = excerptSpan(NOTE, quote, 1)!;
    expect(full.before.endsWith(span.before)).toBe(true);
    expect(full.after.startsWith(span.after.trimEnd()) || full.after.includes(span.after)).toBe(true);
  });

  it("says nothing was cut when the note is already short", () => {
    const short = "Only this. eGFR 62 mL/min/1.73m2 today.";
    const span = excerptSpan(short, "eGFR 62 mL/min/1.73m2", 1)!;
    expect(span.truncated).toBe(false);
    expect(span.before + span.match + span.after).toBe(short);
  });

  it("returns null for a quote that no longer resolves, like highlightSpan", () => {
    expect(excerptSpan(NOTE, "a quote that is not there")).toBeNull();
    expect(excerptSpan(NOTE, "")).toBeNull();
  });

  it("shortens every real card in the bundled queue", () => {
    let shortened = 0;
    for (const file of DEMO_FACTS) {
      for (const entry of file.facts) {
        if (entry.source === undefined) continue;
        const note = DEMO_NOTES[entry.source.doc]!;
        const full = highlightSpan(note, entry.source.quote)!;
        const span = excerptSpan(note, entry.source.quote, 1)!;
        const fullLen = full.before.length + full.match.length + full.after.length;
        const spanLen = span.before.length + span.match.length + span.after.length;
        expect(spanLen).toBeLessThanOrEqual(fullLen);
        if (spanLen < fullLen) shortened += 1;
      }
    }
    expect(shortened).toBeGreaterThan(10);
  });
});
