/**
 * There is exactly one `patient-facts/v1`.
 *
 * The repo used to carry two files under that name — packs/trials/fact-model.yaml
 * (lvef in "percent", the lab_* family) and corpus/fact-model.yaml (lvef in "%",
 * nyha_class, nt_probnp) — so `rules check` gave different answers depending on
 * which one you passed. packs/trials/fact-model.yaml is now the only one, and it
 * is the superset of both vocabularies.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFactModel, parseRuleSet } from "../../src/core/schema.js";
import { collectLeaves } from "../../src/core/lint.js";
import { REPO_ROOT } from "../../scripts/lib/paths.js";

const CANONICAL = join(REPO_ROOT, "packs", "trials", "fact-model.yaml");
const FM = parseFactModel(readFileSync(CANONICAL, "utf8"));

/** Every *.yaml under the repo, minus node_modules and the generated corpora. */
function yamlFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yamlFiles(path, out);
    else if (entry.endsWith(".yaml")) out.push(path);
  }
  return out;
}

describe("the canonical fact model", () => {
  it("is the only file declaring patient-facts/v1", () => {
    const declaring = yamlFiles(REPO_ROOT).filter((p) =>
      /^name:\s*patient-facts\/v1\s*$/m.test(readFileSync(p, "utf8")),
    );
    expect(declaring).toEqual([CANONICAL]);
  });

  it("no longer ships a second fact model in corpus/", () => {
    expect(existsSync(join(REPO_ROOT, "corpus", "fact-model.yaml"))).toBe(false);
  });

  it("spells the lvef unit '%' — never 'percent'", () => {
    const lvef = FM.facts["lvef"];
    expect(lvef).toBeDefined();
    expect(lvef!.type).toBe("number");
    expect(lvef!.type === "number" ? lvef!.unit : undefined).toBe("%");
    for (const [name, decl] of Object.entries(FM.facts)) {
      if (decl.type === "number") expect(decl.unit, name).not.toBe("percent");
    }
  });

  it("keeps both vocabularies: the extracted clinical facts and the lab_* family", () => {
    for (const fact of ["nyha_class", "nt_probnp", "systolic_bp", "potassium", "on_anticoagulant", "hospitalized_for_hf_last_12mo"]) {
      expect(Object.keys(FM.facts), fact).toContain(fact);
    }
    for (const fact of ["lab_lvef", "lab_bnp", "lab_nt_probnp", "lab_egfr", "index_hospital_days"]) {
      expect(Object.keys(FM.facts), fact).toContain(fact);
    }
  });

  it("declares every fact both shipped rule sets reference", () => {
    const rulesets = [
      "rules/trials/demo-hf-001/ruleset.yaml",
      "rules/trials/demo-hf-001/ruleset@1.0.0.yaml",
      "rules/trials/commander-hf/ruleset.yaml",
    ];
    for (const rel of rulesets) {
      const rs = parseRuleSet(readFileSync(join(REPO_ROOT, rel), "utf8"));
      for (const c of rs.criteria) {
        if (c.when === undefined) continue;
        for (const leaf of collectLeaves(c.when)) {
          expect(Object.keys(FM.facts), `${rel} ${c.id} -> ${leaf.fact}`).toContain(leaf.fact);
        }
      }
    }
  });

  it("declares every fact the extraction corpus proposes", () => {
    const dir = join(REPO_ROOT, "corpus", "facts");
    for (const file of readdirSync(dir)) {
      const body = readFileSync(join(dir, file), "utf8");
      for (const m of body.matchAll(/^\s*-\s*fact:\s*([A-Za-z0-9_]+)/gm)) {
        expect(Object.keys(FM.facts), `${file} -> ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it("accepts every sex value the corpus and the extraction prompt allow", () => {
    const sex = FM.facts["sex"];
    expect(sex?.type).toBe("enum");
    expect(sex?.type === "enum" ? [...sex.values].sort() : []).toEqual(["female", "male", "other"]);
  });
});
