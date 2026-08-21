/**
 * Cohort attrition — the single source of truth for "how many patients, and why
 * did the rest fall out".
 *
 * The CLI (`rules screen --report`) and the workbench funnel both consume this
 * module, and that is the whole point of it existing. They used to compute the
 * same story twice: `rules screen` bucketed each patient by `evalPatient`'s
 * order-independent `overall`, while the funnel drained a pool in criterion
 * order and let an `unknown` remove a patient before a later `fail` could. On
 * the shipped commander-hf cohort the two disagreed on every headline number —
 * 0 vs 2 "potentially eligible", 97 vs 92 screen failures — and swapping two
 * criteria in the YAML, a no-op for the engine, moved a patient between the two
 * biggest buckets of the demo's main chart.
 *
 * The reconciliation, in one sentence: **a patient's band comes from
 * `evalPatient().overall` and from nothing else.** The sequential waterfall
 * still exists, because "which criterion removed them first" is the question a
 * feasibility reader actually asks — but it only distributes the patients who
 * are *already* screen failures across the criteria, so the columns can never
 * contradict the bands and the totals always close.
 *
 * Pure: rule set and facts in, counts out. No filesystem, no clock.
 */
import type { PatientFacts, RuleSet } from "./schema.js";
import { evalPatient, type Evaluation } from "./evaluator.js";

/**
 * Derived ONLY from `evalPatient().overall`:
 *   eligible → potentially-eligible · ineligible → screen-fail ·
 *   undetermined → not-evaluable
 *
 * "potentially", because a rule set with unmodeled criteria cannot make anyone
 * eligible on structured data alone, and "not-evaluable" means exactly what it
 * says — undetermined overall, not "removed by a criterion we could not read".
 */
export type PatientBand = "potentially-eligible" | "screen-fail" | "not-evaluable";

export type CriterionAttrition = {
  id: string;
  ref?: string;
  kind: "inclusion" | "exclusion";
  unmodeled: boolean;
  /**
   * Screen failures attributed to this criterion at its position in the rule
   * set: patients whose overall is `ineligible` and whose FIRST failing
   * criterion is this one. Summing this column over all rows gives exactly
   * `bands["screen-fail"]`.
   */
  removedSequential: number;
  /** Patients in the whole cohort this criterion fails, ignoring order. */
  failsAlone: number;
  /**
   * Patients this criterion alone keeps out: it fails and every other MODELED
   * criterion passes, so relaxing it would move them to potentially-eligible.
   * A patient with an `unknown` anywhere else is not counted — relaxing this
   * criterion would leave them not-evaluable, not eligible. Unmodeled criteria
   * are ignored on purpose: they are parked in chart review rather than drained.
   */
  soleReason: number;
};

export type Attrition = {
  n: number;
  bands: Record<PatientBand, number>;
  /** One row per criterion, in rule-set order. */
  rows: CriterionAttrition[];
  patients: { patient: string; band: PatientBand; evaluation: Evaluation }[];
};

export function bandOf<E extends { overall: Evaluation["overall"] }>(e: E): PatientBand {
  return e.overall === "eligible" ? "potentially-eligible" : e.overall === "ineligible" ? "screen-fail" : "not-evaluable";
}

/**
 * The criterion that alone keeps this patient out, if there is one: exactly one
 * modeled criterion fails and every other modeled criterion passes. Exported
 * because the "sole-disqualifier argument" — the list of patients a site would
 * gain by relaxing one criterion — is the reason to compute attrition at all.
 */
export function soleReasonCriterionId(e: Evaluation): string | undefined {
  const modeled = e.results.filter((r) => !r.unmodeled);
  const fails = modeled.filter((r) => r.verdict === "fail");
  if (fails.length !== 1) return undefined;
  return modeled.every((r) => r.verdict === "fail" || r.verdict === "pass") ? fails[0]!.id : undefined;
}

/**
 * A criterion still waiting on a human: unmodeled AND unresolved. Core's own
 * evaluator always leaves unmodeled criteria `unknown`, so on core-produced
 * evaluations this is just "unmodeled" — but a chart-review pass (the
 * workbench's) may resolve an unmodeled criterion's verdict, and then it is no
 * longer parked. `soleReason` ignores parked criteria only.
 */
export const isParked = (r: { unmodeled: boolean; verdict: "pass" | "fail" | "unknown" }): boolean =>
  r.unmodeled && r.verdict === "unknown";

/** Core's overall-aggregation rule over a (possibly rewritten) results list. */
export function overallOf(
  results: readonly { verdict: "pass" | "fail" | "unknown" }[],
): Evaluation["overall"] {
  if (results.some((r) => r.verdict === "fail")) return "ineligible";
  if (results.some((r) => r.verdict === "unknown")) return "undetermined";
  return "eligible";
}

/**
 * The structural shape `attritionFrom` actually reads. Core's `Evaluation`
 * satisfies it; so does a consumer's widened evaluation type (the workbench
 * adds chart-review provenance) — attribution math never touches the extras.
 */
export type AttritionInput = {
  patient: string;
  overall: Evaluation["overall"];
  results: readonly {
    id: string;
    ref?: string;
    kind: "inclusion" | "exclusion";
    unmodeled: boolean;
    verdict: "pass" | "fail" | "unknown";
  }[];
};

export type AttritionOf<E extends AttritionInput> = {
  n: number;
  bands: Record<PatientBand, number>;
  rows: CriterionAttrition[];
  patients: { patient: string; band: PatientBand; evaluation: E }[];
};

/**
 * Attrition over evaluations that already exist — the entry point for callers
 * that rewrite verdicts between the engine and the display (chart review).
 * Criterion order/metadata comes from the first evaluation's results, so with
 * an empty input the rows list is empty (computeAttrition, which holds the
 * rule set, returns a full zeroed rows list instead — the one documented
 * divergence). For core-produced evaluations, `computeAttrition(rs, corpus)`
 * and `attritionFrom(corpus.map(p => evalPatient(rs, p)))` agree exactly —
 * a test pins that equivalence.
 */
export function attritionFrom<E extends AttritionInput>(evaluations: readonly E[]): AttritionOf<E> {
  const n = evaluations.length;
  const bands: Record<PatientBand, number> = { "potentially-eligible": 0, "screen-fail": 0, "not-evaluable": 0 };
  const patients = evaluations.map((evaluation) => {
    const band = bandOf(evaluation);
    bands[band] += 1;
    return { patient: evaluation.patient, band, evaluation };
  });
  if (n === 0) return { n: 0, bands, rows: [], patients };

  const verdictOf = (e: AttritionInput, id: string) => e.results.find((r) => r.id === id)?.verdict;

  const soleReasonIds = evaluations.map((e) => {
    const decisive = e.results.filter((r) => !isParked(r));
    const fails = decisive.filter((r) => r.verdict === "fail");
    if (fails.length !== 1) return undefined;
    return decisive.every((r) => r.verdict === "fail" || r.verdict === "pass") ? fails[0]!.id : undefined;
  });

  let pool: readonly E[] = evaluations;
  const rows: CriterionAttrition[] = evaluations[0]!.results.map((c) => {
    const removedSequential = pool.filter((e) => verdictOf(e, c.id) === "fail").length;
    pool = pool.filter((e) => verdictOf(e, c.id) !== "fail");
    return {
      id: c.id,
      ...(c.ref !== undefined ? { ref: c.ref } : {}),
      kind: c.kind,
      unmodeled: c.unmodeled,
      removedSequential,
      failsAlone: evaluations.filter((e) => verdictOf(e, c.id) === "fail").length,
      soleReason: soleReasonIds.filter((id) => id === c.id).length,
    };
  });

  return { n, bands, rows, patients };
}

export function computeAttrition(rs: RuleSet, corpus: PatientFacts[]): Attrition {
  const patients = corpus.map((p) => {
    const evaluation = evalPatient(rs, p);
    return { patient: p.patient, band: bandOf(evaluation), evaluation };
  });

  const bands: Record<PatientBand, number> = { "potentially-eligible": 0, "screen-fail": 0, "not-evaluable": 0 };
  for (const p of patients) bands[p.band] += 1;

  // A screen failure belongs to the first criterion, in rule-set order, that
  // fails them. `unknown` never removes anyone here — an undetermined patient is
  // already banded not-evaluable and is not in this distribution at all.
  const firstFailure = new Map<string, number>();
  for (const p of patients) {
    if (p.band !== "screen-fail") continue;
    const first = p.evaluation.results.find((r) => r.verdict === "fail");
    if (first === undefined) continue; // unreachable: screen-fail means some verdict is fail
    firstFailure.set(first.id, (firstFailure.get(first.id) ?? 0) + 1);
  }

  const soleCounts = new Map<string, number>();
  for (const p of patients) {
    const id = soleReasonCriterionId(p.evaluation);
    if (id !== undefined) soleCounts.set(id, (soleCounts.get(id) ?? 0) + 1);
  }

  const failsAlone = new Map<string, number>();
  for (const p of patients) {
    for (const r of p.evaluation.results) {
      if (r.verdict === "fail") failsAlone.set(r.id, (failsAlone.get(r.id) ?? 0) + 1);
    }
  }

  const rows: CriterionAttrition[] = rs.criteria.map((c) => ({
    id: c.id,
    ...(c.ref !== undefined ? { ref: c.ref } : {}),
    kind: c.kind,
    unmodeled: c.unmodeled === true || c.when === undefined,
    removedSequential: firstFailure.get(c.id) ?? 0,
    failsAlone: failsAlone.get(c.id) ?? 0,
    soleReason: soleCounts.get(c.id) ?? 0,
  }));

  return { n: corpus.length, bands, rows, patients };
}
