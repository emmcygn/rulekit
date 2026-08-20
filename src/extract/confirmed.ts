/**
 * The rulekit invariant, in code (design spec goal G11).
 *
 * The LLM proposes facts with provenance. Eligibility stays a deterministic
 * function of *confirmed* facts plus rules. This module is the only door
 * between the two halves, and it is deliberately one short function: the
 * invariant is worth more as three lines anyone can read than as a policy
 * spread across the evaluator.
 *
 * A fact reaches the engine iff it is not rejected, and it is either
 * deterministic (`extractedBy: pipeline`) or a human confirmed it. Confidence
 * has no vote. `proposed` never has a vote, at any confidence, ever.
 */
import type { PatientFacts, FactValue } from "../core/schema.js";
import type { FactEntry, FactsFile } from "./schema.js";

/** The single predicate. Everything else in this file is bookkeeping. */
export const isEvaluable = (e: FactEntry): boolean =>
  e.status !== "rejected" && (e.extractedBy === "pipeline" || e.status === "confirmed");

export function confirmedFactsToPatient(file: FactsFile): PatientFacts {
  const facts: Record<string, FactValue> = {};
  const chosen = new Map<string, FactEntry>();

  for (const entry of file.facts) {
    if (!isEvaluable(entry)) continue;
    const prior = chosen.get(entry.fact);
    if (prior !== undefined) {
      // parseFactsFile already blocks this, so it can only arrive from code.
      // Last-write-wins would produce a verdict nobody can explain from the
      // file, which defeats the point of the trace.
      if (JSON.stringify(prior.value) !== JSON.stringify(entry.value)) {
        throw new Error(
          `${file.patient}: conflicting evaluable entries for '${entry.fact}' (${JSON.stringify(prior.value)} vs ${JSON.stringify(entry.value)})`,
        );
      }
      continue;
    }
    chosen.set(entry.fact, entry);
    facts[entry.fact] = structuredClone(entry.value) as FactValue;
  }

  return { patient: file.patient, facts };
}

/**
 * The distinct sub-state of `unknown` the workbench renders as
 * "not evaluable — pending review (N proposed)".
 */
export function pendingReview(file: FactsFile): { count: number; facts: string[] } {
  const facts = file.facts.filter((e) => e.status === "proposed").map((e) => e.fact);
  return { count: facts.length, facts };
}
