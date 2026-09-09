import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRuleSet, parseFactModel, parsePatient, parseTestSuite } from "../../src/core/schema.js";
import { checkRuleSet } from "../../src/core/conflicts.js";
import { runSuite } from "../../src/core/testing.js";
import { behavioralDiff } from "../../src/core/diff.js";

const read = (p: string) => readFileSync(p, "utf8");
const RS = parseRuleSet(read("rules/trials/demo-hf-001/ruleset.yaml"));
const RS_OLD = parseRuleSet(read("rules/trials/demo-hf-001/ruleset@1.0.1.yaml"));
const FM = parseFactModel(read("packs/trials/fact-model.yaml"));
const SUITE = parseTestSuite(read("rules/trials/demo-hf-001/tests.yaml"));
const CORPUS = readdirSync("fixtures/patients").map((f) => parsePatient(read(join("fixtures/patients", f))));

describe("DEMO-HF-001 content (spec weeks 1-2 milestone)", () => {
  it("the shipped rules are valid; partial inclusion/exclusion overlap is not a contradiction", () => {
    const findings = checkRuleSet(RS, FM);
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
  });

  it("the corrected pre-amendment rule set has no conflict", () => {
    expect(checkRuleSet(RS_OLD, FM).filter((f) => f.level === "error")).toHaveLength(0);
  });

  it("keeps the originally published 1.0.0 artifact byte-for-byte", () => {
    const historical = read("rules/trials/demo-hf-001/ruleset@1.0.0.yaml");
    expect(createHash("sha256").update(historical).digest("hex")).toBe("e17aaa9e1220094e5df6a546afda1812f1f51a2e13e6986a93c977881b61d7e9");
  });

  it("keeps the landing, plain, 3D and thesis surfaces honest about the demo band", () => {
    const surfaces = ["README.md", "deploy/landing.html", "docs/plain.html", "docs/clinic/index.html", "docs/thesis.html"];
    for (const surface of surfaces) {
      const text = read(surface);
      expect(text, surface).not.toContain("It finds contradictions before anyone enrolls");
      expect(text, surface).not.toContain("the teaching pack with its contradiction seeded on purpose");
      expect(text, surface).not.toContain("The checker proves that for every possible patient, then fails the build");
    }
    // The README summarizes checker scope; the detailed surfaces explain the band.
    expect(read("README.md")).toContain("checks for some kinds of contradiction");
    for (const surface of ["deploy/landing.html", "docs/plain.html", "docs/clinic/index.html"]) {
      const text = read(surface);
      expect(text, surface).toContain("Values from 30 up to, but excluding, 45 pass the inclusion and trigger the exclusion.");
      expect(text, surface).toContain("The overall result is ineligible.");
      expect(text, surface).toContain("This is ordinary exclusion behavior.");
      expect(text, surface).toContain("does not report a contradiction or fail the build");
    }
  });

  it("all 13 rule-set test cases pass", () => {
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
