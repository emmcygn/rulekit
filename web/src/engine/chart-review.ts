/**
 * Chart-review resolution — the workbench's answer to "I typed NYHA class IV
 * onto a patient and nothing moved" (operator showstopper S2, triage cluster C).
 *
 * ## Why this file exists, and what the arbiter needs to decide
 *
 * The triage ruling was to *model* demo-hf-001's E4 as `nyha_class eq IV` so
 * that confirming a NYHA fact moves the funnel. The closed rule language cannot
 * express that: `src/core/schema.ts` gives `eq`/`neq` a `value: z.number()`, and
 * `in`/`notIn` take a `codes: {system, values}` code list which the evaluator
 * only matches against `CodeEntry[]` values (`src/core/evaluator.ts`,
 * `isCodeEntries`). `nyha_class` is `{ type: enum, values: [I, II, III, IV] }` —
 * a bare string. There is no leaf that compares it. Modelling E4 would mean
 * adding an enum-equality leaf to schema.ts + evaluator.ts + interval.ts +
 * lint.ts, which is FIX-1's surface and a language change, not a demo change.
 *
 * So E4 stays `unmodeled: true` and the honest alternative ships instead: the
 * workbench declares, in one table below, which unmodeled criteria a *human*
 * can resolve from a fact they have confirmed, and applies that resolution
 * between the engine and the screen. The rule set is unchanged; the engine is
 * unchanged; a confirmed `nyha_class` now decides E4 for that patient and the
 * bands move. Every resolved criterion carries `chartReview` provenance so the
 * screen can say *who* decided it and *from what*, and an unresolved one stays
 * `unknown` exactly as before.
 *
 * This is not the engine inventing a verdict. It is the reviewer's decision,
 * recorded against the criterion the protocol text names, and labelled as such.
 */
import type { PatientFacts } from "../../../src/core/schema.js";
import { overallOf } from "./attrition.js";
import type { CriterionResult, Evaluation } from "./api.js";

export type ChartReviewRule = {
  /** The unmodeled criterion a human can settle. */
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
    if (!r.unmodeled || r.verdict !== "unknown") return r;
    const rule = ruleFor(r.id);
    if (rule === undefined) return r;
    const value = facts.facts[rule.fact];
    if (typeof value !== "string") return r;

    const fires = rule.firesOn.includes(value);
    const verdict: CriterionResult["verdict"] =
      r.kind === "exclusion" ? (fires ? "fail" : "pass") : fires ? "pass" : "fail";
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

/** Facts that can settle a chart-review criterion in this rule set. */
export const CHART_REVIEW_FACTS: readonly string[] = CHART_REVIEW_RULES.map((r) => r.fact);
