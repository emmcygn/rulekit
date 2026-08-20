/**
 * Findings that need the cohort, not just the rule set: values the rules
 * compare numerically but the data records as text ("&gt;60"). The engine's
 * `check` is patient-free by design, so these are computed here and labelled as
 * cohort findings.
 */
import type { Condition, PatientFacts, RuleSet } from "../../../src/core/schema.js";
import type { Finding } from "../engine/api.js";
import { factValues } from "../sensitivity/compute.js";

function numericFacts(c: Condition, out: Set<string>): void {
  if ("all" in c) c.all.forEach((k) => numericFacts(k, out));
  else if ("any" in c) c.any.forEach((k) => numericFacts(k, out));
  else if ("not" in c) numericFacts(c.not, out);
  else if ("value" in c) out.add(c.fact);
}

export function cohortFindings(ruleSet: RuleSet, cohort: PatientFacts[]): Finding[] {
  const facts = new Set<string>();
  for (const c of ruleSet.criteria) if (c.when) numericFacts(c.when, facts);

  const out: Finding[] = [];
  for (const fact of facts) {
    const { unusable } = factValues(cohort, fact);
    for (const u of unusable) {
      const criteria = ruleSet.criteria
        .filter((c) => c.when && hasFact(c.when, fact))
        .map((c) => c.id);
      out.push({
        level: "info",
        code: "non-numeric-value",
        message: `${u.patient}'s ${fact} is the string "${u.value}" (a common lab reporting convention), not a number — it evaluates *not evaluable* rather than being guessed at.`,
        criteria,
        evidence: `cohort · ${u.patient} · ${fact} = "${u.value}"`,
      });
    }
  }
  return out;
}

function hasFact(c: Condition, fact: string): boolean {
  if ("all" in c) return c.all.some((k) => hasFact(k, fact));
  if ("any" in c) return c.any.some((k) => hasFact(k, fact));
  if ("not" in c) return hasFact(c.not, fact);
  return c.fact === fact && "value" in c;
}
