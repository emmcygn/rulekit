/**
 * Screening-funnel math (design spec §9.1, G7).
 *
 * The waterfall is still sequential — that is what a feasibility reader expects
 * to see, and it is the honest picture of *criteria*. What it is no longer
 * allowed to do is band *patients*: `bands` here is `attritionFrom`'s, which is
 * `evalPatient().overall`, so the bars and the summary line can never tell two
 * stories about the same person (triage cluster A, uiux B5).
 *
 * `tests/funnel.test.ts` pins the reconciliation: the per-row `removedSequential`
 * column sums to the screen-fail band, and every row's counts come from the same
 * drain rule `attritionFrom` uses.
 *
 * Pure: takes engine evaluations, returns counts. No React, no engine calls.
 */
import { attritionFrom, isParked, type Attrition, type AttritionRow } from "../engine/attrition.js";
import { countsOf, type DisplayBandCounts } from "./bands.js";
import type { Evaluation } from "../engine/api.js";

export type FunnelRow = AttritionRow & {
  /** Patients still in the pool when this criterion is applied. */
  entering: number;
  pass: number;
  fail: number;
  unknown: number;
  /** Patients this criterion parks in chart review instead of draining. */
  chartReview: number;
  /** Patients whose chart review a reviewer has already settled. */
  chartReviewResolved: number;
  patients: { pass: string[]; fail: string[]; unknown: string[] };
};

export type Funnel = {
  n: number;
  rows: FunnelRow[];
  /** The four display bands, derived from `overall`. The only totals on screen. */
  bands: DisplayBandCounts;
  /** The three shared bands, exactly as the CLI reports them. */
  attrition: Attrition;
};

export function computeFunnel(evaluations: readonly Evaluation[]): Funnel {
  const attrition = attritionFrom(evaluations);
  const bands = countsOf(attrition);
  if (attrition.n === 0) return { n: 0, rows: [], bands, attrition };

  const order = evaluations[0]!.results;
  const indexed = evaluations.map((evaluation) => ({
    evaluation,
    byId: new Map(evaluation.results.map((result) => [result.id, result])),
    active: true,
  }));
  const rows: FunnelRow[] = [];

  for (const [i, c] of order.entries()) {
    const patients = { pass: [] as string[], fail: [] as string[], unknown: [] as string[] };
    let entering = 0;
    let chartReview = 0;
    let chartReviewResolved = 0;
    for (const row of indexed) {
      if (!row.active) continue;
      entering += 1;
      const r = row.byId.get(c.id);
      const v = r?.verdict ?? "unknown";
      patients[v === "pass" ? "pass" : v === "fail" ? "fail" : "unknown"].push(
        row.evaluation.patient,
      );
      if (r && isParked(r)) chartReview += 1;
      if (r?.chartReview !== undefined) chartReviewResolved += 1;
      // Same drain rule as `attritionFrom`: only a fail removes anyone. An
      // undecided criterion leaves the patient active for the next one.
      if (v === "fail") row.active = false;
    }

    rows.push({
      ...attrition.rows[i]!,
      entering,
      pass: patients.pass.length,
      fail: patients.fail.length,
      unknown: patients.unknown.length,
      chartReview,
      chartReviewResolved,
      patients,
    });
  }

  return { n: attrition.n, rows, bands, attrition };
}

export type CohortCounts = { potentiallyEligible: number; screenFail: number; notEvaluable: number };

/**
 * The three headline numbers in the shared vocabulary, for callers that want
 * scalars. `pendingChartReview` is folded back into `notEvaluable` here so this
 * matches the CLI exactly; screens use `displayBandCounts` instead.
 */
export function cohortCounts(evaluations: readonly Evaluation[]): CohortCounts {
  const { bands } = attritionFrom(evaluations);
  return {
    potentiallyEligible: bands["potentially-eligible"],
    screenFail: bands["screen-fail"],
    notEvaluable: bands["not-evaluable"],
  };
}
