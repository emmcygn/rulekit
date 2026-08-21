/**
 * Adversarial probes — behavioral diff / amendment view (attack surface 6).
 */
import { describe, it, expect } from "vitest";
import { behavioralDiff, structuralDiff } from "../../src/core/diff.js";
import { checkRuleSet } from "../../src/core/conflicts.js";
import { groupFlips, criterionOrder } from "../../web/src/amendment/compute.js";
import type { Criterion, FactModel, PatientFacts, RuleSet } from "../../src/core/schema.js";

const FM: FactModel = {
  name: "probe/v1",
  facts: { age: { type: "number", unit: "years" }, egfr: { type: "number", unit: "mL/min/1.73m2" } },
};

const rs = (version: string, ...criteria: Criterion[]): RuleSet => ({
  ruleset: "amendment-probe",
  rulesetVersion: version,
  factModel: "probe/v1",
  criteria,
});

const adult: Criterion = { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18 } };

describe("F1 — undetermined → eligible flips carry NO responsible criterion", () => {
  // v1 requires an eGFR nobody in the cohort has → everyone undetermined.
  // v2 drops it → everyone eligible. A 100% outcome change, unattributed.
  const v1 = rs("1.0.0", adult, { id: "renal", kind: "inclusion", verbatim: "eGFR >= 30", when: { fact: "egfr", op: "gte", value: 30 } });
  const v2 = rs("2.0.0", adult);
  const corpus: PatientFacts[] = [{ patient: "SYN-1", facts: { age: 70 } }, { patient: "SYN-2", facts: { age: 55 } }];

  it("`responsible` is empty because attribution only tracks fail-ness", () => {
    const flips = behavioralDiff(v1, v2, corpus);
    expect(flips).toHaveLength(2);
    expect(flips[0]).toMatchObject({ from: "undetermined", to: "eligible", responsible: [] });
    // The CLI (src/cli/index.ts:67) prints: "  SYN-1: undetermined → eligible  ()"
  });

  it("the workbench files them all under an 'unattributed' group", () => {
    const groups = groupFlips(behavioralDiff(v1, v2, corpus), criterionOrder(v2));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.criterionId).toBe(""); // rendered as "unattributed — 2"
  });

  it("the same holds for eligible → undetermined, the direction that matters for safety", () => {
    const flips = behavioralDiff(v2, v1, corpus);
    expect(flips.every((f) => f.responsible.length === 0)).toBe(true);
    expect(flips[0]!.to).toBe("undetermined");
  });
});

describe("F2 — a renamed criterion looks like an unrelated add + remove", () => {
  const v1 = rs("1.0.0", adult, { id: "renal-safety", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 30 } });
  // Same condition, new id (a re-lettering during an amendment).
  const v2 = rs("2.0.0", adult, { id: "e3-renal-safety", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 30 } });

  it("structural diff shows add + remove, never 'renamed'", () => {
    expect(structuralDiff(v1, v2)).toEqual({ added: ["e3-renal-safety"], removed: ["renal-safety"], changed: [] });
  });

  it("behavioral attribution blames the new id for patients whose outcome never moved", () => {
    // Nobody flips (the rule is identical), so the diff is silent...
    const corpus: PatientFacts[] = [{ patient: "LOW-EGFR", facts: { age: 70, egfr: 20 } }];
    expect(behavioralDiff(v1, v2, corpus)).toEqual([]);

    // ...but pair the rename with any real change and the attribution is wrong:
    // the added id is "responsible" purely because the old id is not in v2.
    const v3 = rs("2.0.0", adult, { id: "e3-renal-safety", kind: "exclusion", verbatim: "eGFR < 45", when: { fact: "egfr", op: "lt", value: 45 } });
    const p: PatientFacts[] = [{ patient: "EGFR-40", facts: { age: 70, egfr: 40 } }];
    const flips = behavioralDiff(v1, v3, p);
    expect(flips[0]!.responsible).toEqual(["e3-renal-safety"]);
    // Correct here by luck. Reverse the direction and the removed criterion —
    // the one that actually changed the outcome — cannot be named at all,
    // because `responsible` is built only from the NEW version's results.
    const back = behavioralDiff(v3, v1, p);
    expect(back[0]).toMatchObject({ from: "ineligible", to: "eligible" });
    expect(back[0]!.responsible).toEqual([]);
  });
});

describe("F3 — rule content can change with the version string standing still", () => {
  const v1 = rs("1.0.0", adult, { id: "renal", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 30 } });
  const v2 = rs("1.0.0", adult, { id: "renal", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 45 } });

  it("nothing in the toolchain notices the un-bumped rulesetVersion", () => {
    expect(v1.rulesetVersion).toBe(v2.rulesetVersion);
    expect(structuralDiff(v1, v2).changed).toEqual(["renal"]);
    const corpus: PatientFacts[] = [{ patient: "EGFR-40", facts: { age: 70, egfr: 40 } }];
    expect(behavioralDiff(v1, v2, corpus)).toHaveLength(1); // the cohort moves
    // ...and `rules check` on the amended file is clean, so CI passes a rule
    // change that is invisible to anyone tracking versions.
    expect(checkRuleSet(v2, FM).filter((f) => f.level !== "info")).toEqual([]);
    // Neither diff output mentions the version at all.
    expect(JSON.stringify(structuralDiff(v1, v2))).not.toContain("1.0.0");
  });

  it("`verbatim` drift is invisible to the diff — the audit trail can lie", () => {
    const relabelled: RuleSet = rs("1.0.0", adult, {
      id: "renal",
      kind: "exclusion",
      verbatim: "eGFR < 45 (amended per protocol v3)",
      when: { fact: "egfr", op: "lt", value: 30 },
    });
    // normalize() in src/core/diff.ts hashes kind/when/unmodeled only.
    expect(structuralDiff(v1, relabelled)).toEqual({ added: [], removed: [], changed: [] });
    // MISLEADS: the source-of-truth protocol text changed under a criterion and
    // `rules diff` reports "no change".
  });
});
