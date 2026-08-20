import { describe, it, expect } from "vitest";
import { andTri, orTri, notTri, type Tri } from "../../src/core/tri.js";

const T: Tri = "true", F: Tri = "false", U: Tri = "unknown";

describe("Kleene logic", () => {
  it("andTri truth table", () => {
    expect(andTri([T, T])).toBe(T);
    expect(andTri([T, F])).toBe(F);
    expect(andTri([T, U])).toBe(U);
    expect(andTri([F, U])).toBe(F);   // false absorbs unknown
    expect(andTri([U, U])).toBe(U);
    expect(andTri([])).toBe(T);       // vacuous truth
  });
  it("orTri truth table", () => {
    expect(orTri([F, F])).toBe(F);
    expect(orTri([T, F])).toBe(T);
    expect(orTri([F, U])).toBe(U);
    expect(orTri([T, U])).toBe(T);    // true absorbs unknown
    expect(orTri([U, U])).toBe(U);
    expect(orTri([])).toBe(F);
  });
  it("notTri", () => {
    expect(notTri(T)).toBe(F);
    expect(notTri(F)).toBe(T);
    expect(notTri(U)).toBe(U);
  });
});
