/**
 * SWAP FILE — the workbench's copy of the shared `computeAttrition` contract.
 *
 * FIX-1 is landing `src/core/attrition.ts` with exactly the API below, consumed
 * by both `rules screen --report` and this workbench so the CLI and the GUI can
 * never answer the same question with different numbers again (triage cluster
 * A). Until that merges, this file *is* the implementation; afterwards the whole
 * body is replaced by
 *
 *     export * from "../../../src/core/attrition.js";
 *
 * and nothing else in web/ changes, because nothing else imports the math.
 * `tests/attrition.test.ts` pins the contract shape so the swap is checkable.
 *
 * The one rule that matters here: **a patient's band is a function of
 * `evalPatient().overall` and nothing else.** Not of where a sequential
 * waterfall happened to drop them. The waterfall still exists — `rows` carries
 * it, and the funnel draws it — but it describes criteria, not patients.
 */
import { evalPatient } from "../../../src/core/index.js";
import type { PatientFacts, RuleSet } from "../../../src/core/schema.js";
import type { CriterionResult, Evaluation } from "./api.js";

/** The three bands the CLI and the workbench share. */
export type Band = "potentially-eligible" | "screen-fail" | "not-evaluable";

export const BANDS: Band[] = ["potentially-eligible", "screen-fail", "not-evaluable"];

export type AttritionRow = {
  id: string;
  ref?: string;
  kind: CriterionResult["kind"];
  unmodeled: boolean;
  /** Screen failures this criterion causes at its position in the screening order. */
  removedSequential: number;
  /** Patients in the whole cohort this criterion fails, ignoring order. */
  failsAlone: number;
  /**
   * Patients this criterion alone keeps out: it fails and every other modeled
   * criterion passes, so relaxing it would move them into the eligible band. A
   * patient with an unknown elsewhere is NOT counted — relaxing this criterion
   * would leave them undetermined, not eligible.
   */
  soleReason: number;
};

export type BandedPatient = { patient: string; band: Band; evaluation: Evaluation };

export type Attrition = {
  n: number;
  bands: Record<Band, number>;
  rows: AttritionRow[];
  patients: BandedPatient[];
};

/**
 * A criterion still waiting on a human: unmodeled in the rule set and not yet
 * resolved from a confirmed fact. This is the one unknown that does not mean
 * "missing data", so it is the one the display bands split out and the one
 * `soleReason` ignores.
 */
export const isParked = (r: CriterionResult): boolean => r.unmodeled && r.verdict === "unknown";

/**
 * The whole banding rule, in three lines. `overall` is the engine's own verdict
 * on the patient; the band is a rename of it, never a recomputation.
 */
export function bandOf(evaluation: Evaluation): Band {
  if (evaluation.overall === "ineligible") return "screen-fail";
  if (evaluation.overall === "eligible") return "potentially-eligible";
  return "not-evaluable";
}

/**
 * Recompute `overall` from a results list using core's exact rule. Needed only
 * by callers that rewrite a criterion's verdict after evaluation (the chart
 * review resolver); kept here so there is one copy of the rule in web/.
 */
export function overallOf(results: readonly CriterionResult[]): Evaluation["overall"] {
  if (results.some((r) => r.verdict === "fail")) return "ineligible";
  if (results.some((r) => r.verdict === "unknown")) return "undetermined";
  return "eligible";
}

/**
 * The attrition report over evaluations that have already been computed.
 *
 * `computeAttrition` below is the contract entry point; this one exists because
 * the workbench applies a chart-review resolution pass between the engine and
 * the screen (see `./chart-review.ts`) and must band the resolved evaluations,
 * not re-derive them from the rule set.
 */
export function attritionFrom(evaluations: readonly Evaluation[]): Attrition {
  const n = evaluations.length;
  const bands: Record<Band, number> = {
    "potentially-eligible": 0,
    "screen-fail": 0,
    "not-evaluable": 0,
  };
  const patients: BandedPatient[] = evaluations.map((evaluation) => {
    const band = bandOf(evaluation);
    bands[band] += 1;
    return { patient: evaluation.patient, band, evaluation };
  });

  if (n === 0) return { n: 0, bands, rows: [], patients };

  const order = evaluations[0]!.results;
  const verdictOf = (e: Evaluation, id: string) => e.results.find((r) => r.id === id)?.verdict;

  // A criterion is a patient's sole reason only when relaxing it would actually
  // make them eligible — one fail and everything else a pass. A criterion still
  // waiting on a chart review is ignored: it is not missing data, so it does not
  // stop a relaxation from paying off.
  const soleReasonIdPerPatient = evaluations.map((e) => {
    const decisive = e.results.filter((r) => !isParked(r));
    const fails = decisive.filter((r) => r.verdict === "fail");
    if (fails.length !== 1) return undefined;
    return decisive.every((r) => r.verdict === "fail" || r.verdict === "pass")
      ? fails[0]!.id
      : undefined;
  });

  let pool: readonly Evaluation[] = evaluations;
  const rows: AttritionRow[] = [];
  for (const c of order) {
    const fail = pool.filter((e) => verdictOf(e, c.id) === "fail");
    const failsAlone = evaluations.filter((e) => verdictOf(e, c.id) === "fail").length;
    const soleReason = soleReasonIdPerPatient.filter((id) => id === c.id).length;

    rows.push({
      id: c.id,
      ...(c.ref === undefined ? {} : { ref: c.ref }),
      kind: c.kind,
      unmodeled: c.unmodeled,
      removedSequential: fail.length,
      failsAlone,
      soleReason,
    });

    // One drain rule, and only fails drain.
    //
    // The old waterfall also dropped a patient at the first criterion it could
    // not decide, which is how SYN-042 came to be "not evaluable" in the totals
    // and "screen fail" in their own trace 400px away (uiux B5): they were
    // unknown at E1 and so never reached the E3 that actually failed them. An
    // unknown does not remove anyone from screening — it leaves one criterion
    // undecided — so they keep flowing and are removed by the criterion that
    // really excludes them, if any. The consequence is arithmetic: every
    // ineligible patient is removed exactly once, so the `removed (sequential)`
    // column sums to the screen-fail band and the pool that survives is exactly
    // the other three bands. `tests/funnel.test.ts` asserts both.
    pool = pool.filter((e) => verdictOf(e, c.id) !== "fail");
  }

  return { n, bands, rows, patients };
}

/** The contract entry point: rule set + corpus in, banded report out. */
export function computeAttrition(rs: RuleSet, corpus: readonly PatientFacts[]): Attrition {
  return attritionFrom(corpus.map((p) => evalPatient(rs, p)));
}
