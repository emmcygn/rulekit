import { describe, expect, it } from "vitest";
import { parseRuleSet } from "../../src/core/schema.js";
import { realEngine } from "../src/engine/real.js";
import type { Evaluation, Flip } from "../src/engine/api.js";
import {
  amendmentImpact,
  criterionOrder,
  deltaLine,
  enrolledImpact,
  groupFlips,
  structuralDiff,
} from "../src/amendment/compute.js";
import { resolveChartReview } from "../src/engine/chart-review.js";
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
        "when: { fact: lvef, op: lte, value: 40, unit: \"%\" }",
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
  const flips = realEngine.behavioralDiff(DEMO_RULESET_PRIOR, DEMO_RULESET_CURRENT, DEMO_COHORT);

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

describe("amendmentImpact — the headline is the list", () => {
  const resolved = (yaml: string) =>
    DEMO_COHORT.map((p) => resolveChartReview(realEngine.evalPatient(yaml, p), p));
  const impact = amendmentImpact(resolved(DEMO_RULESET_PRIOR), resolved(DEMO_RULESET_CURRENT));

  it("counts exactly the patients it then names", () => {
    // The shipped headline said "3 of 10 change outcome" over deltas of −2/+2
    // (uiux B5). The count and the list are now the same array.
    const groups = groupFlips(impact.flips, criterionOrder(current));
    const named = groups.reduce((n, g) => n + g.flips.length, 0);
    expect(named).toBe(impact.flips.length);
    expect(impact.flips).toHaveLength(8);
    expect(impact.flips.map((f) => f.patient).sort()).toEqual([
      "SYN-007",
      "SYN-019",
      "SYN-042",
      "SYN-058",
      "SYN-061",
      "SYN-088",
      "SYN-104",
      "SYN-121",
    ]);
  });

  it("states deltas that add up to the same move", () => {
    // Every band that changed size is listed, and the sizes that grew balance
    // the ones that shrank.
    expect(deltaLine(impact)).toBe(
      "screen fail 2 → 7, not evaluable 1 → 3, pending chart review 7 → 0",
    );
    const grew = impact.moved.reduce((n, b) => n + Math.max(0, impact.after[b] - impact.before[b]), 0);
    const shrank = impact.moved.reduce((n, b) => n + Math.max(0, impact.before[b] - impact.after[b]), 0);
    expect(grew).toBe(shrank);
    // Net deltas can be smaller than the patient-level transition list when
    // patients move both into and out of the same band.
    expect(grew).toBeLessThanOrEqual(impact.flips.length);
  });

  it("includes every flip the core engine finds", () => {
    const core = realEngine.behavioralDiff(DEMO_RULESET_PRIOR, DEMO_RULESET_CURRENT, DEMO_COHORT);
    const named = new Set(impact.flips.map((f) => f.patient));
    for (const f of core) expect(named).toContain(f.patient);
  });

  it("attributes each flip to the criteria whose verdict actually changed", () => {
    const syn088 = impact.flips.find((f) => f.patient === "SYN-088")!;
    expect(syn088.responsible).toContain("anticoag-washout");
    const syn007 = impact.flips.find((f) => f.patient === "SYN-007")!;
    expect(syn007.responsible).toEqual(["renal-safety", "nyha-class-iv"]);
    expect(impact.flips.find((f) => f.patient === "SYN-061")!.responsible).toEqual(["nyha-class-iv"]);
  });

  it("says nothing changed when nothing changed", () => {
    const same = amendmentImpact(resolved(DEMO_RULESET_CURRENT), resolved(DEMO_RULESET_CURRENT));
    expect(same.flips).toEqual([]);
    expect(deltaLine(same)).toBe("no band changes size");
  });
});

describe("enrolledImpact", () => {
  const rows = DEMO_ENROLLED.map((e) => ({
    participant: e.participant,
    site: e.site,
    randomized: e.randomized,
    before: realEngine.evalPatient(DEMO_RULESET_PRIOR, e.patient),
    after: realEngine.evalPatient(DEMO_RULESET_CURRENT, e.patient),
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
