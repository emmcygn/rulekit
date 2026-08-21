/**
 * Structural checks on the COMMANDER HF pack. These do not run the evaluator
 * (that lives in src/core and is built separately) — they check the things a
 * hand-authored rule set gets wrong: a test referring to a criterion that no
 * longer exists, a modelled criterion only ever exercised in one direction,
 * a criterion that lost its provenance.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRuleSet, parseTestSuite } from "../../src/core/schema.js";
import { REPO_ROOT } from "../../scripts/lib/paths.js";

const DIR = join(REPO_ROOT, "rules", "trials", "commander-hf");
const ruleset = parseRuleSet(readFileSync(join(DIR, "ruleset.yaml"), "utf8"));
const suite = parseTestSuite(readFileSync(join(DIR, "tests.yaml"), "utf8"));

const modelled = ruleset.criteria.filter((c) => c.when !== undefined);
const unmodelled = ruleset.criteria.filter((c) => c.unmodeled === true);

describe("provenance", () => {
  it("links to the real study", () => {
    expect(ruleset.source?.nctId).toBe("NCT01877915");
    expect(ruleset.source?.url).toContain("NCT01877915");
  });

  it("gives every criterion a protocol ref and a verbatim source line", () => {
    for (const c of ruleset.criteria) {
      expect(c.ref, c.id).toMatch(/^(AGE|I\d+|E\d+)$/);
      expect(c.verbatim.length, c.id).toBeGreaterThan(20);
    }
  });

  it("keeps the refs unique and in protocol order", () => {
    const refs = ruleset.criteria.map((c) => c.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toEqual(["AGE", "I1", "I2", "I3", "I4", "I5", "I6", "E1", "E2", "E3", "E4", "E5"]);
  });

  it("records the criteria it cannot model rather than dropping them", () => {
    expect(unmodelled.map((c) => c.ref)).toEqual(["I2", "I5", "E1", "E5"]);
    expect(modelled).toHaveLength(8);
  });
});

describe("tests.yaml", () => {
  const ids = new Set(ruleset.criteria.map((c) => c.id));

  it("only expects criteria that exist", () => {
    for (const c of suite.cases) {
      for (const key of Object.keys(c.expect)) {
        if (key === "overall") continue;
        expect(ids, `${c.name} -> ${key}`).toContain(key);
      }
    }
  });

  it("only expects legal verdicts", () => {
    for (const c of suite.cases) {
      for (const [key, verdict] of Object.entries(c.expect)) {
        const legal = key === "overall" ? ["eligible", "ineligible", "undetermined"] : ["pass", "fail", "unknown"];
        expect(legal, `${c.name} -> ${key}`).toContain(verdict);
      }
    }
  });

  it("exercises every modelled criterion in both directions", () => {
    for (const c of modelled) {
      const verdicts = new Set(suite.cases.map((tc) => tc.expect[c.id]).filter(Boolean));
      expect([...verdicts].sort(), `${c.ref} ${c.id}`).toEqual(expect.arrayContaining(["fail", "pass"]));
    }
  });

  it("never expects an unmodelled criterion to resolve", () => {
    for (const c of unmodelled) {
      for (const tc of suite.cases) {
        const verdict = tc.expect[c.id];
        if (verdict !== undefined) expect(verdict, `${c.id} in "${tc.name}"`).toBe("unknown");
      }
    }
  });

  it("covers both outcome columns the pack can reach", () => {
    const overalls = new Set(suite.cases.map((c) => c.expect["overall"]));
    expect(overalls).toEqual(new Set(["ineligible", "undetermined"]));
  });

  it("has a case for at least one unknown leaf on every fact family", () => {
    const unknowns = suite.cases.flatMap((c) => Object.entries(c.expect).filter(([, v]) => v === "unknown").map(([k]) => k));
    for (const id of ["lvef-40-or-below", "index-stay-over-21-days", "symptomatic-heart-failure"]) {
      expect(unknowns, id).toContain(id);
    }
  });
});

describe("CI coverage", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("the dogfood script runs check and test on this pack, not just the demo", () => {
    const dogfood = pkg.scripts["dogfood"] ?? "";
    expect(dogfood).toContain("check rules/trials/commander-hf/ruleset.yaml");
    expect(dogfood).toContain("test rules/trials/commander-hf");
    expect(dogfood).toContain("check rules/trials/demo-hf-001/ruleset@1.0.0.yaml");
    expect(dogfood).toContain("test rules/trials/demo-hf-001");
  });
});
