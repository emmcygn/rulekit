/**
 * Adversarial probes — behavioral diff / amendment view (attack surface 6).
 */
import { describe, it, expect } from "vitest";
import { behavioralDiff, structuralDiff, versionWarning } from "../../src/core/diff.js";
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

const adult: Criterion = { id: "adult", kind: "inclusion", verbatim: "Age >= 18", when: { fact: "age", op: "gte", value: 18, unit: "years" } };

describe("F1 — undetermined ↔ eligible flips are attributed (REGRESSION: used to be unattributed)", () => {
  // v1 requires an eGFR nobody in the cohort has → everyone undetermined.
  // v2 drops it → everyone eligible. A 100% outcome change, and `renal` owns it.
  const v1 = rs("1.0.0", adult, { id: "renal", kind: "inclusion", verbatim: "eGFR >= 30", when: { fact: "egfr", op: "gte", value: 30, unit: "mL/min/1.73m2" } });
  const v2 = rs("2.0.0", adult);
  const corpus: PatientFacts[] = [{ patient: "SYN-1", facts: { age: 70 } }, { patient: "SYN-2", facts: { age: 55 } }];

  it("attribution tracks any verdict change, so the dropped criterion is named", () => {
    const flips = behavioralDiff(v1, v2, corpus);
    expect(flips).toHaveLength(2);
    // `renal` has no result in v2 at all; a criterion that no longer exists
    // reads as `pass`, so its unknown → pass move is the attributable one.
    expect(flips[0]).toEqual({ patient: "SYN-1", from: "undetermined", to: "eligible", responsible: ["renal"] });
    expect(flips[1]!.responsible).toEqual(["renal"]);
  });

  it("the safety-relevant direction — eligible → undetermined — names `renal`", () => {
    const flips = behavioralDiff(v2, v1, corpus);
    expect(flips).toHaveLength(2);
    expect(flips[0]!.to).toBe("undetermined");
    expect(flips.every((f) => f.responsible.includes("renal"))).toBe(true);
  });

  it("the workbench groups them under the criterion, not under 'unattributed'", () => {
    const groups = groupFlips(behavioralDiff(v2, v1, corpus), criterionOrder(v1));
    expect(groups.map((g) => g.criterionId)).toEqual(["renal"]);
  });

  it("an unknown → pass flip inside a surviving criterion is attributed too", () => {
    // Same criterion in both versions; the threshold moves so a patient who
    // was `fail` becomes `pass`. No fail-ness → pass-ness subtlety here, but
    // the unknown case is the one that used to vanish:
    const strict = rs("1.0.0", adult, { id: "renal", kind: "inclusion", verbatim: "eGFR >= 30", when: { fact: "egfr", op: "gte", value: 30, unit: "mL/min/1.73m2" } });
    const relaxed = rs("1.1.0", adult, { id: "renal", kind: "inclusion", verbatim: "eGFR >= 10", when: { fact: "egfr", op: "gte", value: 10, unit: "mL/min/1.73m2" } });
    const p: PatientFacts[] = [{ patient: "EGFR-20", facts: { age: 70, egfr: 20 } }];
    expect(behavioralDiff(strict, relaxed, p)[0]!.responsible).toEqual(["renal"]);
  });
});

describe("F2 — exact criterion renames are explicit", () => {
  const v1 = rs("1.0.0", adult, { id: "renal-safety", ref: "E3", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 30 } });
  // Same condition, new id (a re-lettering during an amendment).
  const v2 = rs("2.0.0", adult, { id: "e3-renal-safety", ref: "E3", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 30 } });

  it("structural diff reports the rename", () => {
    expect(structuralDiff(v1, v2)).toEqual({ added: [], removed: [], changed: [], renamed: [{ from: "renal-safety", to: "e3-renal-safety" }], reordered: [], metadataChanged: [] });
  });

  it("behavioral attribution aligns a renamed criterion by stable protocol ref", () => {
    // Nobody flips (the rule is identical), so the diff is silent...
    const corpus: PatientFacts[] = [{ patient: "LOW-EGFR", facts: { age: 70, egfr: 20 } }];
    expect(behavioralDiff(v1, v2, corpus)).toEqual([]);

    // Pair the rename with a real threshold change. The stable ref identifies
    // one logical criterion across both versions.
    const v3 = rs("2.0.0", adult, { id: "e3-renal-safety", ref: "E3", kind: "exclusion", verbatim: "eGFR < 45", when: { fact: "egfr", op: "lt", value: 45 } });
    const p: PatientFacts[] = [{ patient: "EGFR-40", facts: { age: 70, egfr: 40 } }];
    const flips = behavioralDiff(v1, v3, p);
    expect(flips[0]!.responsible).toEqual(["e3-renal-safety"]);
    expect(structuralDiff(v1, v3)).toMatchObject({
      added: [], removed: [], changed: ["e3-renal-safety"],
      renamed: [{ from: "renal-safety", to: "e3-renal-safety" }],
    });
    const back = behavioralDiff(v3, v1, p);
    expect(back[0]).toMatchObject({ from: "ineligible", to: "eligible" });
    expect(back[0]!.responsible).toEqual(["renal-safety"]);
  });

  it("does not call a wholesale replacement a rename just because its ref was reused", () => {
    const replacement = rs("2.0.0", adult, {
      id: "e3-comorbidity",
      ref: "E3",
      kind: "exclusion",
      verbatim: "Age below 50",
      when: { fact: "age", op: "lt", value: 50, unit: "years" },
    });
    expect(structuralDiff(v1, replacement)).toMatchObject({
      added: ["e3-comorbidity"],
      removed: ["renal-safety"],
      renamed: [],
    });
  });

  it("tracks an exact rename even when its protocol ref also changes", () => {
    const movedRef = rs("2.0.0", adult, {
      id: "e4-renal-safety",
      ref: "E4",
      kind: "exclusion",
      verbatim: "eGFR < 30",
      when: { fact: "egfr", op: "lt", value: 30 },
    });
    expect(structuralDiff(v1, movedRef)).toMatchObject({
      added: [],
      removed: [],
      changed: ["e4-renal-safety"],
      renamed: [{ from: "renal-safety", to: "e4-renal-safety" }],
    });
  });
});

describe("F3 — rule content can change with the version string standing still", () => {
  const v1 = rs("1.0.0", adult, { id: "renal", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 30, unit: "mL/min/1.73m2" } });
  const v2 = rs("1.0.0", adult, { id: "renal", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 45, unit: "mL/min/1.73m2" } });

  it("`rules diff` warns about the un-bumped rulesetVersion (REGRESSION: was silent)", () => {
    expect(v1.rulesetVersion).toBe(v2.rulesetVersion);
    const s = structuralDiff(v1, v2);
    expect(s.changed).toEqual(["renal"]);
    const corpus: PatientFacts[] = [{ patient: "EGFR-40", facts: { age: 70, egfr: 40 } }];
    expect(behavioralDiff(v1, v2, corpus)).toHaveLength(1); // the cohort moves
    // `rules check` on the amended file is still clean — it is a lint, not a
    // governance tool — so the warning has to come from `rules diff`.
    expect(checkRuleSet(v2, FM).filter((f) => f.level !== "info")).toEqual([]);
    const warning = versionWarning(v1, v2, s)!;
    expect(warning).toContain("both files declare rulesetVersion 1.0.0");
    expect(warning).toContain("bump the version");
  });

  it("a real version bump, or no structural change at all, warns about nothing", () => {
    const bumped = rs("1.1.0", adult, { id: "renal", kind: "exclusion", verbatim: "eGFR < 30", when: { fact: "egfr", op: "lt", value: 45, unit: "mL/min/1.73m2" } });
    expect(versionWarning(v1, bumped, structuralDiff(v1, bumped))).toBeUndefined();
    expect(versionWarning(v1, v1, structuralDiff(v1, v1))).toBeUndefined();
  });

  it("`verbatim` drift is a structural change", () => {
    const relabelled: RuleSet = rs("1.0.0", adult, {
      id: "renal",
      kind: "exclusion",
      verbatim: "eGFR < 45 (amended per protocol v3)",
      when: { fact: "egfr", op: "lt", value: 30, unit: "mL/min/1.73m2" },
    });
    // normalize() in src/core/diff.ts hashes kind/when/unmodeled only.
    expect(structuralDiff(v1, relabelled).changed).toEqual(["renal"]);
  });
});
