/**
 * The locked contract of the rulekit core engine.
 *
 * The core (src/core/evaluator.ts, conflicts.ts, diff.ts) is being built in
 * parallel; the workbench codes against this interface only. At integration a
 * `realEngine` implementation lands next to `mockEngine` and the app's engine
 * selection (see ./index.ts) switches over — nothing else in web/ changes.
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
