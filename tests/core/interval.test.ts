import { describe, it, expect } from "vitest";
import { FULL, fromLeaf, intersect, isEmpty, isFull, fmtInterval } from "../../src/core/interval.js";

describe("interval arithmetic", () => {
  it("fromLeaf builds the right bounds", () => {
    expect(fromLeaf("gte", 30)).toEqual({ lo: 30, hi: Infinity, loOpen: false, hiOpen: true });
    expect(fromLeaf("lt", 45)).toEqual({ lo: -Infinity, hi: 45, loOpen: true, hiOpen: true });
    expect(fromLeaf("eq", 5)).toEqual({ lo: 5, hi: 5, loOpen: false, hiOpen: false });
  });

  it("the spec's contradictory band: [30, ∞) ∩ (−∞, 45) = [30, 45), non-empty", () => {
    const band = intersect(fromLeaf("gte", 30), fromLeaf("lt", 45));
    expect(band).toEqual({ lo: 30, hi: 45, loOpen: false, hiOpen: true });
    expect(isEmpty(band)).toBe(false);
    expect(fmtInterval(band)).toBe("[30, 45)");
  });

  it("empty when bounds cross or touch open", () => {
    expect(isEmpty(intersect(fromLeaf("gte", 65), fromLeaf("lt", 60)))).toBe(true);
    expect(isEmpty(intersect(fromLeaf("gt", 45), fromLeaf("lt", 45)))).toBe(true);
    expect(isEmpty(intersect(fromLeaf("gte", 45), fromLeaf("lte", 45)))).toBe(false); // the single point 45
  });

  it("FULL identity and formatting", () => {
    expect(isFull(intersect(FULL, FULL))).toBe(true);
    expect(fmtInterval(FULL)).toBe("(−∞, ∞)");
  });
});
