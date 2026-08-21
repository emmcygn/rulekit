import { describe, expect, it } from "vitest";
import type { CriterionResult, Evaluation } from "../src/engine/api.js";
import { computeFunnel } from "../src/funnel/compute.js";
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
  const overall = results.some((r) => r.verdict === "fail")
    ? ("ineligible" as const)
    : results.some((r) => r.verdict === "unknown")
      ? ("undetermined" as const)
      : ("eligible" as const);
  return { patient, results, overall };
}

describe("computeFunnel — sequential attrition", () => {
  it("drains the pool in criterion order: fails are removed, unknowns leave the funnel", () => {
    const f = computeFunnel([
      evaluation("A", "ppp"),
      evaluation("B", "fpp"),
      evaluation("C", "pfp"),
      evaluation("D", "pup"),
    ]);
    expect(f.n).toBe(4);
    // C fails and D is unknown at criterion 1, so only A reaches criterion 2.
    expect(f.rows.map((r) => r.entering)).toEqual([4, 3, 1]);
    expect(f.rows.map((r) => r.fail)).toEqual([1, 1, 0]);
    expect(f.rows.map((r) => r.unknown)).toEqual([0, 1, 0]);
    expect(f.rows.map((r) => r.removedSequential)).toEqual([1, 1, 0]);
    expect(f.screenFail).toBe(2);
    expect(f.notEvaluable).toBe(1);
    expect(f.remaining).toBe(1);
  });

  it("always accounts for every patient exactly once", () => {
    const f = computeFunnel([
      evaluation("A", "ppp"),
      evaluation("B", "fup"),
      evaluation("C", "ufp"),
      evaluation("D", "puf"),
    ]);
    expect(f.screenFail + f.notEvaluable + f.remaining).toBe(f.n);
  });

  it("passes the pool through an unmodeled criterion instead of draining it", () => {
    const f = computeFunnel([evaluation("A", "ppU"), evaluation("B", "pfU")]);
    const last = f.rows[2]!;
    expect(last.unmodeled).toBe(true);
    expect(last.chartReview).toBe(1);
    expect(f.remaining).toBe(1);
    expect(f.notEvaluable).toBe(0);
  });

  it("counts fails-alone over the whole cohort, ignoring screening order", () => {
    // B fails criterion 0 and would also fail criterion 1, but the sequential
    // funnel never sees it at criterion 1.
    const f = computeFunnel([evaluation("A", "pfp"), evaluation("B", "ffp")]);
    expect(f.rows[1]!.entering).toBe(1);
    expect(f.rows[1]!.fail).toBe(1);
    expect(f.rows[1]!.failsAlone).toBe(2);
  });

  it("credits sole reason only when relaxing the criterion would make the patient eligible", () => {
    const f = computeFunnel([
      evaluation("A", "fpp"), // sole reason: criterion 0
      evaluation("B", "ffp"), // two failures: neither is sole
      evaluation("C", "ppf"), // sole reason: criterion 2
      evaluation("D", "puf"), // fail plus an unknown: relaxing 2 leaves D undetermined
    ]);
    expect(f.rows.map((r) => r.soleReason)).toEqual([1, 0, 1]);
  });

  it("an unmodeled criterion's chart-review unknown does not cancel a sole reason", () => {
    // The funnel parks unmodeled criteria in chart review rather than draining
    // the pool, so they do not stop a relaxation from reaching "remaining".
    const f = computeFunnel([evaluation("A", "fpU"), evaluation("B", "fuU")]);
    expect(f.rows.map((r) => r.soleReason)).toEqual([1, 0, 0]);
  });

  it("lists the patients behind each bucket for the drill-down", () => {
    const f = computeFunnel([evaluation("A", "pp"), evaluation("B", "fp"), evaluation("C", "up")]);
    expect(f.rows[0]!.patients).toEqual({ pass: ["A"], fail: ["B"], unknown: ["C"] });
    expect(f.rows[1]!.patients.pass).toEqual(["A"]);
  });

  it("returns an empty funnel for an empty cohort", () => {
    const f = computeFunnel([]);
    expect(f).toEqual({ n: 0, rows: [], screenFail: 0, notEvaluable: 0, remaining: 0 });
  });
});

describe("computeFunnel — bundled demo cohort", () => {
  const evals = DEMO_COHORT.map((p) => realEngine.evalPatient(DEMO_RULESET_CURRENT, p));
  const f = computeFunnel(evals);

  it("balances the books on the demo data", () => {
    expect(f.n).toBe(10);
    expect(f.screenFail + f.notEvaluable + f.remaining).toBe(10);
    expect([f.screenFail, f.notEvaluable, f.remaining]).toEqual([6, 1, 3]);
  });

  it("shows the amendment's renal exclusion as the biggest sole-reason bucket", () => {
    const renal = f.rows.find((r) => r.id === "renal-safety")!;
    const others = f.rows.filter((r) => r.id !== "renal-safety");
    expect(renal.soleReason).toBeGreaterThan(0);
    for (const row of others) expect(row.soleReason).toBeLessThanOrEqual(renal.soleReason);
  });

  it("excludes SYN-042 from renal-safety's sole reason: their washout is unknown", () => {
    const syn042 = evals.find((e) => e.patient === "SYN-042")!;
    const verdict = (id: string) => syn042.results.find((r) => r.id === id)!.verdict;
    expect(verdict("renal-safety")).toBe("fail");
    expect(verdict("anticoag-washout")).toBe("unknown");

    const renal = f.rows.find((r) => r.id === "renal-safety")!;
    expect(renal.patients.fail).not.toContain("SYN-042");
    // Relaxing the eGFR floor would leave SYN-042 undetermined, not eligible,
    // so they must not be counted as a sole-reason screen failure.
    const soleReasonPatients = evals.filter(
      (e) =>
        e.results.find((r) => r.id === "renal-safety")!.verdict === "fail" &&
        e.results.every((r) => r.id === "renal-safety" || r.unmodeled || r.verdict === "pass"),
    );
    expect(soleReasonPatients.map((e) => e.patient)).not.toContain("SYN-042");
    expect(renal.soleReason).toBe(soleReasonPatients.length);
  });

  it("never drains the pool at the unmodeled criterion", () => {
    const nyha = f.rows.find((r) => r.id === "nyha-class-iv")!;
    expect(nyha.removedSequential).toBe(0);
    expect(nyha.chartReview).toBe(f.remaining);
  });
});
