/**
 * Chart-review resolution — the workbench's answer to "I typed NYHA class IV
 * onto a patient and nothing moved" (operator showstopper S2, triage cluster C).
 *
 * The engine now models demo-hf-001's E4 directly as `nyha_class eq IV`.
 * For the current rule set this adapter only annotates a verdict whose input
 * entered through the human review queue. It retains the old resolution path
 * solely so the historical unmodeled version remains comparable.
 */
import type { PatientFacts } from "../../../src/core/schema.js";
import { overallOf } from "./attrition.js";
import type { CriterionResult, Evaluation } from "./api.js";

export type ChartReviewRule = {
  /** Criterion whose input may arrive through human chart review. */
  criterionId: string;
  /** The fact model fact that settles it. */
  fact: string;
  /** Values on which the criterion's condition is TRUE (an exclusion fires). */
  firesOn: readonly string[];
  /** Rendered next to the resolution so the screen never states it bare. */
  verbatimBasis: string;
};

/**
 * demo-hf-001 only. `commander-hf` keeps four genuinely unmodeled criteria and
 * appears in no table here, which is where the unmodeled-honesty story lives.
 */
export const CHART_REVIEW_RULES: readonly ChartReviewRule[] = [
  {
    criterionId: "nyha-class-iv",
    fact: "nyha_class",
    firesOn: ["IV"],
    verbatimBasis: "NYHA class IV heart failure",
  },
];

const ruleFor = (criterionId: string): ChartReviewRule | undefined =>
  CHART_REVIEW_RULES.find((r) => r.criterionId === criterionId);

export type ChartReviewResolution = {
  fact: string;
  value: string;
  /** "nyha_class = III (confirmed in review) → exclusion does not fire". */
  detail: string;
};

/**
 * Apply every chart-review rule this patient has a value for.
 *
 * Only facts the engine can already see are used — which, after `applyReview`,
 * means the structured record plus whatever a human has confirmed. A proposed
 * fact nobody has decided is not in `facts` and therefore resolves nothing,
 * which is the rulekit invariant holding on this path too.
 */
export function resolveChartReview(evaluation: Evaluation, facts: PatientFacts): Evaluation {
  let changed = false;
  const results: CriterionResult[] = evaluation.results.map((r) => {
    const rule = ruleFor(r.id);
    if (rule === undefined) return r;
    const value = facts.facts[rule.fact];
    if (typeof value !== "string") return r;

    const fires = rule.firesOn.includes(value);
    const verdict: CriterionResult["verdict"] = r.unmodeled
      ? r.kind === "exclusion" ? (fires ? "fail" : "pass") : fires ? "pass" : "fail"
      : r.verdict;
    if (verdict === "unknown") return r;
    changed = true;
    return {
      ...r,
      verdict,
      chartReview: {
        fact: rule.fact,
        value,
        detail: `${rule.fact} = ${value} (confirmed in review) → ${
          r.kind === "exclusion"
            ? fires
              ? "exclusion fired"
              : "exclusion does not fire"
            : fires
              ? "criterion met"
              : "criterion not met"
        }`,
      },
    };
  });
  if (!changed) return evaluation;
  return { patient: evaluation.patient, results, overall: overallOf(results) };
}

/** Facts that can feed or settle a chart-review criterion in this rule set. */
export const CHART_REVIEW_FACTS: readonly string[] = CHART_REVIEW_RULES.map((r) => r.fact);
