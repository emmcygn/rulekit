/**
 * The shared attrition contract (triage cluster A).
 *
 * These tests are the swap guard for `web/src/engine/attrition.ts`: when FIX-1's
 * `src/core/attrition.ts` lands and that file becomes a re-export, this suite
 * must still pass unchanged. Everything asserted here is contract, not
 * implementation — the shape of the return value, and the one rule that a band
 * comes from `evalPatient().overall` and from nothing else.
 */
import { describe, expect, it } from "vitest";
import { parseRuleSet } from "../../src/core/schema.js";
import { attritionFrom, bandOf, computeAttrition, overallOf } from "../src/engine/attrition.js";
import type { CriterionResult, Evaluation } from "../src/engine/api.js";
import { realEngine } from "../src/engine/real.js";
import { DEMO_COHORT, DEMO_RULESET_CURRENT } from "../src/data/index.js";

/** Compact evaluation builder: "p" pass, "f" fail, "u" unknown, "U" unmodeled. */
function evaluation(patient: string, spec: string, ids = "abcdefg"): Evaluation {
  const results: CriterionResult[] = [...spec].map((ch, i) => ({
    id: ids[i] as string,
    kind: "inclusion" as const,
    verdict: ch === "p" ? "pass" : ch === "f" ? "fail" : "unknown",
    unmodeled: ch === "U",
  }));
  return { patient, results, overall: overallOf(results) };
}

describe("bandOf — the only banding rule", () => {
  it("renames `overall`, and does nothing else", () => {
    expect(bandOf({ patient: "A", results: [], overall: "eligible" })).toBe("potentially-eligible");
    expect(bandOf({ patient: "A", results: [], overall: "ineligible" })).toBe("screen-fail");
    expect(bandOf({ patient: "A", results: [], overall: "undetermined" })).toBe("not-evaluable");
  });

  it("bands a patient the same wherever the waterfall would have dropped them", () => {
    // SYN-042 is unknown at anticoag-washout, which the sequential waterfall
    // reaches first, and fails renal-safety, which it reaches later. The old
    // funnel called them "not evaluable" while their own trace badge said
    // "screen fail" (uiux B5). One `overall`, one band.
    const e = evaluation("SYN-042", "ppuf");
    expect(e.overall).toBe("ineligible");
    expect(bandOf(e)).toBe("screen-fail");
  });
});

describe("attritionFrom — the contract shape", () => {
  const a = attritionFrom([
    evaluation("A", "ppp"),
    evaluation("B", "fpp"),
    evaluation("C", "pfp"),
    evaluation("D", "pup"),
  ]);

  it("returns n, bands, rows and patients", () => {
    expect(Object.keys(a).sort()).toEqual(["bands", "n", "patients", "rows"]);
    expect(a.n).toBe(4);
    expect(Object.keys(a.bands).sort()).toEqual([
      "not-evaluable",
      "potentially-eligible",
      "screen-fail",
    ]);
  });

  it("bands sum to n and match the per-patient bands", () => {
    const total = a.bands["potentially-eligible"] + a.bands["screen-fail"] + a.bands["not-evaluable"];
    expect(total).toBe(a.n);
    for (const p of a.patients) expect(p.band).toBe(bandOf(p.evaluation));
  });

  it("carries the sequential waterfall on rows, and it reconciles with the bands", () => {
    expect(a.rows.map((r) => r.removedSequential)).toEqual([1, 1, 0]);
    const removed = a.rows.reduce((n, r) => n + r.removedSequential, 0);
    expect(removed).toBe(a.bands["screen-fail"]);
  });

  it("counts fails-alone over the whole cohort, ignoring screening order", () => {
    // B fails criterion 0 and would also fail criterion 1, but the sequential
    // waterfall removed them at 0 and never sees them again.
    const f = attritionFrom([evaluation("A", "pfp"), evaluation("B", "ffp")]);
    expect(f.rows[1]!.failsAlone).toBe(2);
    expect(f.rows[1]!.removedSequential).toBe(1); // A only
  });

  it("removes every ineligible patient exactly once, whatever else is unknown", () => {
    // The reconciliation that uiux B5 was about: an unknown does not take a
    // patient out of the funnel, so the criterion that really fails them gets
    // the credit and the column sums to the band.
    const f = attritionFrom([
      evaluation("A", "ppp"),
      evaluation("B", "puf"),
      evaluation("C", "upf"),
      evaluation("D", "fuu"),
    ]);
    expect(f.rows.map((r) => r.removedSequential)).toEqual([1, 0, 2]);
    const removed = f.rows.reduce((n, r) => n + r.removedSequential, 0);
    expect(removed).toBe(f.bands["screen-fail"]);
    expect(removed).toBe(3);
  });

  it("credits sole reason only when relaxing the criterion would make the patient eligible", () => {
    const f = attritionFrom([
      evaluation("A", "fpp"), // sole reason: criterion 0
      evaluation("B", "ffp"), // two failures: neither is sole
      evaluation("C", "ppf"), // sole reason: criterion 2
      evaluation("D", "puf"), // fail plus an unknown: relaxing 2 leaves D undetermined
    ]);
    expect(f.rows.map((r) => r.soleReason)).toEqual([1, 0, 1]);
  });

  it("parks an unmodeled criterion instead of draining the pool", () => {
    const f = attritionFrom([evaluation("A", "ppU"), evaluation("B", "pfU")]);
    expect(f.rows[2]!.removedSequential).toBe(0);
    // A is undetermined (E-like criterion unknown) — not eligible, and honest
    // about it: the shared band is not-evaluable.
    expect(f.bands["potentially-eligible"]).toBe(0);
    expect(f.bands["not-evaluable"]).toBe(1);
    expect(f.bands["screen-fail"]).toBe(1);
  });

  it("does not claim sole reason while a parked criterion remains unknown", () => {
    const f = attritionFrom([evaluation("A", "fpU"), evaluation("B", "fuU")]);
    expect(f.rows.map((r) => r.soleReason)).toEqual([0, 0, 0]);
    expect(f.rows.map((r) => r.soleModeledReason)).toEqual([1, 0, 0]);
  });

  it("returns an empty report for an empty cohort", () => {
    const empty = attritionFrom([]);
    expect(empty.n).toBe(0);
    expect(empty.rows).toEqual([]);
    expect(empty.patients).toEqual([]);
  });
});

describe("computeAttrition — rule set + corpus in", () => {
  const rs = parseRuleSet(DEMO_RULESET_CURRENT);

  it("is attritionFrom over the engine's own evaluations", () => {
    const direct = computeAttrition(rs, DEMO_COHORT);
    const viaEngine = attritionFrom(
      DEMO_COHORT.map((p) => realEngine.evalPatient(DEMO_RULESET_CURRENT, p)),
    );
    expect(direct).toEqual(viaEngine);
  });

  it("agrees with `rules screen` on the demo cohort: 0 eligible, 7 ineligible, 3 undetermined", () => {
    // The number the CLI prints and the number the workbench prints are now the
    // same number (operator M1: GUI said 3 potentially eligible, CLI said 0).
    const a = computeAttrition(rs, DEMO_COHORT);
    expect(a.bands).toEqual({
      "potentially-eligible": 0,
      "screen-fail": 7,
      "not-evaluable": 3,
    });
    const overalls = DEMO_COHORT.map((p) => realEngine.evalPatient(DEMO_RULESET_CURRENT, p).overall);
    expect(overalls.filter((o) => o === "ineligible")).toHaveLength(a.bands["screen-fail"]);
    expect(overalls.filter((o) => o === "eligible")).toHaveLength(a.bands["potentially-eligible"]);
    expect(overalls.filter((o) => o === "undetermined")).toHaveLength(a.bands["not-evaluable"]);
  });
});
