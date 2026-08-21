import { describe, expect, it } from "vitest";
import type { CriterionResult, Evaluation } from "../src/engine/api.js";
import { computeFunnel } from "../src/funnel/compute.js";
import { displayBandCounts, displayBandOf, summaryLine } from "../src/funnel/bands.js";
import { attritionFrom, overallOf } from "../src/engine/attrition.js";
import { realEngine } from "../src/engine/real.js";
import { resolveChartReview } from "../src/engine/chart-review.js";
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

describe("computeFunnel — sequential attrition", () => {
  it("drains the pool on fails only: an unknown leaves the criterion undecided, not the funnel", () => {
    const f = computeFunnel([
      evaluation("A", "ppp"),
      evaluation("B", "fpp"),
      evaluation("C", "pfp"),
      evaluation("D", "pup"),
    ]);
    expect(f.n).toBe(4);
    // B is removed at criterion 0 and C at criterion 1. D is undecided at
    // criterion 1 and carries on to 2, where a later fail could still catch them.
    expect(f.rows.map((r) => r.entering)).toEqual([4, 3, 2]);
    expect(f.rows.map((r) => r.fail)).toEqual([1, 1, 0]);
    expect(f.rows.map((r) => r.unknown)).toEqual([0, 1, 0]);
    expect(f.rows.map((r) => r.removedSequential)).toEqual([1, 1, 0]);
    expect(f.bands).toEqual({
      "screen-fail": 2,
      "not-evaluable": 1,
      "pending-chart-review": 0,
      "potentially-eligible": 1,
    });
  });

  it("bands every patient by the engine's verdict, not by where the waterfall dropped them", () => {
    // D is unknown at criterion 1 and fails criterion 2. The waterfall drops
    // them at 1; the engine calls them ineligible. One status wins: the engine's.
    const f = computeFunnel([evaluation("A", "ppp"), evaluation("D", "puf")]);
    expect(f.rows[1]!.unknown).toBe(1);
    expect(f.bands["screen-fail"]).toBe(1);
    expect(f.bands["not-evaluable"]).toBe(0);
    expect(displayBandOf(evaluation("D", "puf"))).toBe("screen-fail");
  });

  it("always accounts for every patient exactly once", () => {
    const f = computeFunnel([
      evaluation("A", "ppp"),
      evaluation("B", "fup"),
      evaluation("C", "ufp"),
      evaluation("D", "puf"),
    ]);
    const total =
      f.bands["screen-fail"] +
      f.bands["not-evaluable"] +
      f.bands["pending-chart-review"] +
      f.bands["potentially-eligible"];
    expect(total).toBe(f.n);
  });

  it("passes the pool through an unmodeled criterion instead of draining it", () => {
    const f = computeFunnel([evaluation("A", "ppU"), evaluation("B", "pfU")]);
    const last = f.rows[2]!;
    expect(last.unmodeled).toBe(true);
    expect(last.chartReview).toBe(1);
    expect(last.removedSequential).toBe(0);
    // A is not "potentially eligible" — an exclusion nobody has read is still
    // outstanding, and the band says exactly that.
    expect(f.bands["pending-chart-review"]).toBe(1);
    expect(f.bands["potentially-eligible"]).toBe(0);
    expect(f.bands["not-evaluable"]).toBe(0);
  });

  it("counts fails-alone over the whole cohort, ignoring screening order", () => {
    const f = computeFunnel([evaluation("A", "pfp"), evaluation("B", "ffp")]);
    expect(f.rows[1]!.entering).toBe(1);
    expect(f.rows[1]!.fail).toBe(1);
    expect(f.rows[1]!.failsAlone).toBe(2);
  });

  it("lists the patients behind each bucket for the drill-down", () => {
    const f = computeFunnel([evaluation("A", "pp"), evaluation("B", "fp"), evaluation("C", "up")]);
    expect(f.rows[0]!.patients).toEqual({ pass: ["A"], fail: ["B"], unknown: ["C"] });
    // C was undecided at criterion 0, not removed by it, so they are still here.
    expect(f.rows[1]!.patients.pass).toEqual(["A", "C"]);
  });

  it("returns an empty funnel for an empty cohort", () => {
    const f = computeFunnel([]);
    expect(f.n).toBe(0);
    expect(f.rows).toEqual([]);
  });
});

describe("display bands reconcile with the shared bands", () => {
  const evals = DEMO_COHORT.map((p) =>
    resolveChartReview(realEngine.evalPatient(DEMO_RULESET_CURRENT, p), p),
  );

  it("splits not-evaluable without changing its size", () => {
    const shared = attritionFrom(evals).bands;
    const shown = displayBandCounts(evals);
    expect(shown["screen-fail"]).toBe(shared["screen-fail"]);
    expect(shown["potentially-eligible"]).toBe(shared["potentially-eligible"]);
    expect(shown["not-evaluable"] + shown["pending-chart-review"]).toBe(shared["not-evaluable"]);
  });

  it("gives the demo cohort one status per patient across every surface", () => {
    const f = computeFunnel(evals);
    for (const p of f.attrition.patients) {
      const shown = displayBandOf(p.evaluation);
      // The refinement never contradicts the shared band, it only narrows it.
      if (p.band === "not-evaluable") {
        expect(["not-evaluable", "pending-chart-review"]).toContain(shown);
      } else {
        expect(shown).toBe(p.band);
      }
    }
  });
});

describe("computeFunnel — bundled demo cohort", () => {
  const evals = DEMO_COHORT.map((p) =>
    resolveChartReview(realEngine.evalPatient(DEMO_RULESET_CURRENT, p), p),
  );
  const f = computeFunnel(evals);

  it("balances the books on the demo data, and agrees with the CLI", () => {
    expect(f.n).toBe(10);
    expect(f.bands).toEqual({
      "screen-fail": 7,
      "not-evaluable": 0,
      "pending-chart-review": 3,
      "potentially-eligible": 0,
    });
    expect(summaryLine(f.bands)).toBe("7 screen fail · 3 pending chart review");
  });

  it("reconciles the waterfall's removals with the screen-fail band", () => {
    const removed = f.rows.reduce((n, r) => n + r.removedSequential, 0);
    expect(removed).toBe(f.bands["screen-fail"]);
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
    // The waterfall now reaches SYN-042 at renal-safety and credits it with the
    // removal, so the row and the band tell the same story…
    expect(f.rows.find((r) => r.id === "renal-safety")!.patients.fail).toContain("SYN-042");
    expect(displayBandOf(syn042)).toBe("screen-fail");
    // …while sole-reason still excludes them: relaxing the eGFR floor would
    // leave SYN-042 undetermined on the washout, not eligible.
    const renal = f.rows.find((r) => r.id === "renal-safety")!;
    expect(renal.patients.fail).toHaveLength(4);
    expect(renal.soleReason).toBe(3);
  });

  it("never drains the pool at the unmodeled criterion", () => {
    const nyha = f.rows.find((r) => r.id === "nyha-class-iv")!;
    expect(nyha.removedSequential).toBe(0);
    expect(nyha.chartReview).toBe(f.bands["pending-chart-review"]);
  });
});
