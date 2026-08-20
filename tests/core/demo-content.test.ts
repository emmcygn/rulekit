import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRuleSet, parseFactModel, parsePatient, parseTestSuite } from "../../src/core/schema.js";
import { checkRuleSet } from "../../src/core/conflicts.js";
import { runSuite } from "../../src/core/testing.js";
import { behavioralDiff } from "../../src/core/diff.js";

const read = (p: string) => readFileSync(p, "utf8");
const RS = parseRuleSet(read("rules/trials/demo-hf-001/ruleset.yaml"));
const RS_OLD = parseRuleSet(read("rules/trials/demo-hf-001/ruleset@1.0.0.yaml"));
const FM = parseFactModel(read("packs/trials/fact-model.yaml"));
const SUITE = parseTestSuite(read("rules/trials/demo-hf-001/tests.yaml"));
const CORPUS = readdirSync("fixtures/patients").map((f) => parsePatient(read(join("fixtures/patients", f))));

describe("DEMO-HF-001 content (spec weeks 1-2 milestone)", () => {
  it("check catches exactly the seeded conflict and the unit warning", () => {
    const findings = checkRuleSet(RS, FM);
    expect(findings.filter((f) => f.level === "error").map((f) => f.code)).toEqual(["contradictory-band"]);
    expect(findings.find((f) => f.code === "contradictory-band")!.evidence).toContain("[30, 45)");
    expect(findings.filter((f) => f.code === "unit-mismatch")).toHaveLength(1);
  });

  it("the pre-amendment rule set has no conflict", () => {
    expect(checkRuleSet(RS_OLD, FM).filter((f) => f.level === "error")).toHaveLength(0);
  });

  it("all 10 rule-set test cases pass", () => {
    const r = runSuite(RS, SUITE);
    expect(r.cases.filter((c) => !c.ok)).toEqual([]);
  });

  it("amendment diff flips the expected fixtures", () => {
    const flips = behavioralDiff(RS_OLD, RS, CORPUS);
    const flipped = flips.map((f) => f.patient).sort();
    expect(flipped).toEqual(["SYN-007", "SYN-019", "SYN-042", "SYN-058", "SYN-088"]);
    expect(flips.find((f) => f.patient === "SYN-088")!.responsible).toEqual(["anticoag-washout"]);
    expect(flips.find((f) => f.patient === "SYN-007")!.responsible).toEqual(["renal-safety"]);
  });
});
