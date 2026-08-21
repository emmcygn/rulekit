/**
 * The locked contract of the rulekit core engine.
 *
 * Every view codes against this interface and never against an implementation.
 * `./real.ts` satisfies it by wrapping src/core; it is the only implementation
 * in the app, and the only file in web/ that imports core's evaluator, conflict
 * or diff passes.
 *
 * The types below are structurally core's (src/core/evaluator.ts, lint.ts,
 * diff.ts) with `code` and the trace's `observed` widened, so core's return
 * values satisfy them without conversion.
 */
export type Tri = "true" | "false" | "unknown";
export type TraceNode = {
  kind: "all" | "any" | "not" | "leaf";
  result: Tri;
  detail: string;
  children?: TraceNode[];
  observed?: unknown;
};
export type CriterionResult = {
  id: string;
  ref?: string;
  kind: "inclusion" | "exclusion";
  verdict: "pass" | "fail" | "unknown";
  unmodeled: boolean;
  trace?: TraceNode;
};
export type Evaluation = {
  patient: string;
  results: CriterionResult[];
  overall: "eligible" | "ineligible" | "undetermined";
};
export type Finding = {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  criteria: string[];
  evidence?: string;
};
export type Flip = { patient: string; from: string; to: string; responsible: string[] };
export interface Engine {
  evalPatient(
    rulesetYaml: string,
    patient: import("../../../src/core/schema.js").PatientFacts,
  ): Evaluation;
  check(rulesetYaml: string, factModelYaml: string): Finding[];
  behavioralDiff(
    aYaml: string,
    bYaml: string,
    corpus: import("../../../src/core/schema.js").PatientFacts[],
  ): Flip[];
}
