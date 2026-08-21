/**
 * Screening-funnel math (design spec §9.1, G7).
 *
 * Pure: takes engine evaluations, returns counts. No React, no engine calls.
 */
import type { CriterionResult, Evaluation } from "../engine/api.js";

export type FunnelRow = {
  id: string;
  ref?: string;
  kind: CriterionResult["kind"];
  unmodeled: boolean;
  /** Patients still in the pool when this criterion is applied. */
  entering: number;
  pass: number;
  fail: number;
  unknown: number;
  /** Screen failures this criterion causes at its position in the order. */
  removedSequential: number;
  /** Patients in the whole cohort this criterion fails, ignoring order. */
  failsAlone: number;
  /**
   * Patients this criterion alone keeps out: it fails and every other modeled
   * criterion passes, so relaxing it would move them into `remaining`. A
   * patient with an unknown elsewhere is NOT counted — relaxing this criterion
   * would leave them undetermined, not eligible. Unmodeled criteria are ignored
   * because the funnel parks them in chart review instead of draining the pool.
   */
  soleReason: number;
  /** Unmodeled criteria park the remaining pool in chart review instead of draining it. */
  chartReview: number;
  patients: { pass: string[]; fail: string[]; unknown: string[] };
};

export type Funnel = {
  n: number;
  rows: FunnelRow[];
  /** Removed by some criterion. */
  screenFail: number;
  /** Left the funnel because a criterion could not be evaluated on their data. */
  notEvaluable: number;
  /** Survived every modeled criterion — "potentially eligible". */
  remaining: number;
};

export function computeFunnel(evaluations: Evaluation[]): Funnel {
  const n = evaluations.length;
  if (n === 0) return { n: 0, rows: [], screenFail: 0, notEvaluable: 0, remaining: 0 };

  const order = evaluations[0]!.results;
  const verdictOf = (e: Evaluation, id: string) => e.results.find((r) => r.id === id)?.verdict;

  // Order-independent columns: what each criterion does to the full cohort.
  // A criterion is a patient's sole reason only when relaxing it would actually
  // make them eligible — one fail and everything else a pass. An unknown
  // anywhere else means the patient would come out undetermined instead, so
  // they belong to no criterion's sole-reason bucket.
  const soleReasonIdPerPatient = evaluations.map((e) => {
    const modeled = e.results.filter((r) => !r.unmodeled);
    const fails = modeled.filter((r) => r.verdict === "fail");
    if (fails.length !== 1) return undefined;
    return modeled.every((r) => r.verdict === "fail" || r.verdict === "pass") ? fails[0]!.id : undefined;
  });

  let pool = evaluations;
  let screenFail = 0;
  let notEvaluable = 0;
  const rows: FunnelRow[] = [];

  for (const c of order) {
    const buckets = { pass: [] as Evaluation[], fail: [] as Evaluation[], unknown: [] as Evaluation[] };
    for (const e of pool) {
      const v = verdictOf(e, c.id) ?? "unknown";
      buckets[v === "pass" ? "pass" : v === "fail" ? "fail" : "unknown"].push(e);
    }

    const failsAlone = evaluations.filter((e) => verdictOf(e, c.id) === "fail").length;
    const soleReason = soleReasonIdPerPatient.filter((id) => id === c.id).length;

    if (c.unmodeled) {
      // Not computable from structured data: everyone still standing needs a
      // chart review, but nobody is removed and nobody is called eligible.
      rows.push({
        id: c.id,
        ref: c.ref,
        kind: c.kind,
        unmodeled: true,
        entering: pool.length,
        pass: 0,
        fail: 0,
        unknown: pool.length,
        removedSequential: 0,
        failsAlone,
        soleReason,
        chartReview: pool.length,
        patients: { pass: [], fail: [], unknown: pool.map((e) => e.patient) },
      });
      continue;
    }

    rows.push({
      id: c.id,
      ref: c.ref,
      kind: c.kind,
      unmodeled: false,
      entering: pool.length,
      pass: buckets.pass.length,
      fail: buckets.fail.length,
      unknown: buckets.unknown.length,
      removedSequential: buckets.fail.length,
      failsAlone,
      soleReason,
      chartReview: 0,
      patients: {
        pass: buckets.pass.map((e) => e.patient),
        fail: buckets.fail.map((e) => e.patient),
        unknown: buckets.unknown.map((e) => e.patient),
      },
    });

    screenFail += buckets.fail.length;
    notEvaluable += buckets.unknown.length;
    pool = buckets.pass;
  }

  return { n, rows, screenFail, notEvaluable, remaining: pool.length };
}

export type CohortCounts = { potentiallyEligible: number; screenFail: number; notEvaluable: number };

/** The three headline numbers, defined by the funnel so the bars always add up. */
export function cohortCounts(evaluations: Evaluation[]): CohortCounts {
  const f = computeFunnel(evaluations);
  return { potentiallyEligible: f.remaining, screenFail: f.screenFail, notEvaluable: f.notEvaluable };
}
