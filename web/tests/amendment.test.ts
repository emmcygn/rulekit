import { describe, expect, it } from "vitest";
import { parseRuleSet } from "../../src/core/schema.js";
import { mockEngine } from "../src/engine/mock.js";
import type { Evaluation, Flip } from "../src/engine/api.js";
import { criterionOrder, enrolledImpact, groupFlips, structuralDiff } from "../src/amendment/compute.js";
import {
  DEMO_COHORT,
  DEMO_ENROLLED,
  DEMO_RULESET_CURRENT,
  DEMO_RULESET_PRIOR,
} from "../src/data/index.js";

const prior = parseRuleSet(DEMO_RULESET_PRIOR);
const current = parseRuleSet(DEMO_RULESET_CURRENT);

describe("structuralDiff", () => {
  const changes = structuralDiff(prior, current);

  it("reports the criterion the amendment added", () => {
    const added = changes.find((c) => c.kind === "added");
    expect(added?.id).toBe("renal-safety");
    expect(added?.ref).toBe("E3");
  });

  it("reports a changed criterion with the scalar that moved", () => {
    const changed = changes.find((c) => c.kind === "changed" && c.id === "anticoag-washout");
    expect(changed?.summary).toBe("windowDays 14 → 30");
  });

  it("leaves untouched criteria out of the diff", () => {
    expect(changes.map((c) => c.id)).not.toContain("age-min");
  });

  it("reports removals when a criterion disappears", () => {
    const changes = structuralDiff(current, prior);
    const removed = changes.find((c) => c.kind === "removed");
    expect(removed?.id).toBe("renal-safety");
  });

  it("says so when a condition is rewritten rather than retuned", () => {
    const rewritten = parseRuleSet(
      DEMO_RULESET_PRIOR.replace(
        "when: { fact: lvef, op: lte, value: 40 }",
        "when:\n      any:\n        - { fact: lvef, op: lte, value: 40 }\n        - { fact: lvef, op: eq, value: 41 }",
      ),
    );
    const changed = structuralDiff(prior, rewritten).find((c) => c.id === "lvef-max");
    expect(changed?.kind).toBe("changed");
    expect(changed?.summary).toBe("condition rewritten");
  });
});

describe("groupFlips", () => {
  const order = criterionOrder(current);
  const flips = mockEngine.behavioralDiff(DEMO_RULESET_PRIOR, DEMO_RULESET_CURRENT, DEMO_COHORT);

  it("finds the flips the amendment causes on the demo cohort", () => {
    expect(flips.map((f) => f.patient).sort()).toEqual([
      "SYN-007",
      "SYN-019",
      "SYN-042",
      "SYN-058",
      "SYN-088",
    ]);
    expect(flips.every((f) => f.to === "ineligible")).toBe(true);
  });

  it("puts every flip in exactly one group, biggest group first", () => {
    const groups = groupFlips(flips, order);
    expect(groups.map((g) => g.criterionId)).toEqual(["renal-safety", "anticoag-washout"]);
    expect(groups.map((g) => g.flips.length)).toEqual([4, 1]);
    expect(groups.reduce((n, g) => n + g.flips.length, 0)).toBe(flips.length);
  });

  it("attributes a multi-cause flip to the earliest responsible criterion", () => {
    const flip: Flip = {
      patient: "X",
      from: "undetermined",
      to: "ineligible",
      responsible: ["renal-safety", "lvef-max"],
    };
    expect(groupFlips([flip], order)[0]!.criterionId).toBe("lvef-max");
  });

  it("keeps unattributed flips visible instead of dropping them", () => {
    const flip: Flip = { patient: "X", from: "eligible", to: "undetermined", responsible: [] };
    const groups = groupFlips([flip], order);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.criterionId).toBe("");
  });
});

describe("enrolledImpact", () => {
  const rows = DEMO_ENROLLED.map((e) => ({
    participant: e.participant,
    site: e.site,
    randomized: e.randomized,
    before: mockEngine.evalPatient(DEMO_RULESET_PRIOR, e.patient),
    after: mockEngine.evalPatient(DEMO_RULESET_CURRENT, e.patient),
  }));

  it("surfaces only participants the amendment would now exclude", () => {
    const impacted = enrolledImpact(rows);
    expect(impacted.map((i) => i.participant)).toEqual(["002-0041", "003-0017"]);
  });

  it("names the criterion that now catches them, with the observed value", () => {
    const first = enrolledImpact(rows)[0]!;
    expect(first.reasons[0]!.id).toBe("renal-safety");
    expect(first.reasons[0]!.detail).toContain("39");
  });

  it("ignores participants already ineligible before the amendment", () => {
    const before: Evaluation = {
      patient: "P",
      overall: "ineligible",
      results: [{ id: "x", kind: "exclusion", verdict: "fail", unmodeled: false }],
    };
    const after: Evaluation = { ...before };
    expect(
      enrolledImpact([{ participant: "P", site: "s", randomized: "d", before, after }]),
    ).toEqual([]);
  });
});
