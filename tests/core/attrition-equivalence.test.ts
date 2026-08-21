import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRuleSet, parsePatient, evalPatient } from "../../src/core/index.js";
import { computeAttrition, attritionFrom } from "../../src/core/attrition.js";

const rs = parseRuleSet(readFileSync("rules/trials/demo-hf-001/ruleset.yaml", "utf8"));
const corpus = readdirSync("fixtures/patients")
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => parsePatient(readFileSync(join("fixtures/patients", f), "utf8")));

describe("attrition equivalence (the swap guard)", () => {
  it("computeAttrition(rs, corpus) === attritionFrom(evaluations) on core-produced evaluations", () => {
    const a = computeAttrition(rs, corpus);
    const b = attritionFrom(corpus.map((p) => evalPatient(rs, p)));
    expect(b).toEqual(a);
  });
});
