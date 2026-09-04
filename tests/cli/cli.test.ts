import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

function run(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("npx", ["tsx", "src/cli/index.ts", ...args], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { status: err.status, stdout: String(err.stdout) };
  }
}

describe("rules CLI", () => {
  it("check accepts ordinary inclusion/exclusion overlap and corrected units", () => {
    const r = run(["check", "rules/trials/demo-hf-001/ruleset.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("contradictory-band");
    expect(r.stdout).not.toContain("unit-mismatch");
  });

  it("check exits 0 on the clean pre-amendment version", () => {
    const r = run(["check", "rules/trials/demo-hf-001/ruleset@1.0.0.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(0);
  });

  it("a fully clean check states the scope of the analysis rather than implying a proof", () => {
    const r = run(["check", "rules/trials/commander-hf/ruleset.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "0 conflict(s), 0 warning(s) — static analysis covers interval and direct code-set proofs; incomplete criteria are labeled above.",
    );
  });

  it("analysis coverage limitations are explicit", () => {
    const r = run(["check", "rules/trials/demo-hf-001/ruleset.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.stdout).toContain("analysis-incomplete");
    expect(r.stdout).toContain("not proven conflict-free");
  });

  it("test runs the suite with coverage", () => {
    const r = run(["test", "rules/trials/demo-hf-001", "--fact-model", "packs/trials/fact-model.yaml", "--corpus", "fixtures/patients", "--coverage"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("13/13 cases pass");
    expect(r.stdout).toMatch(/coverage/i);
  });

  it("diff prints the version pair, structural changes and flips", () => {
    const r = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.0.yaml", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rulesetVersion 1.0.0 → 1.2.0");
    expect(r.stdout).toContain("+ added renal-safety");
    expect(r.stdout).toContain("SYN-088");
    // The demo bumps its version, so no governance warning here.
    expect(r.stdout).not.toContain("unbumped-version");
  });

  it("diff warns when the content moved but the version did not", () => {
    const r = run(["diff", "rules/trials/demo-hf-001/ruleset.yaml", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.stdout).not.toContain("unbumped-version"); // identical files: no change
    const temp = "/tmp/rulekit-unbumped.yaml";
    writeFileSync(temp, readFileSync("rules/trials/demo-hf-001/ruleset.yaml", "utf8").replace("rulesetVersion: 1.2.0", "rulesetVersion: 1.0.0"));
    const same = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.0.yaml", temp, "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(same.stdout).toContain("! WARNING unbumped-version");
    expect(same.stdout).toContain("both files declare rulesetVersion 1.0.0");
    rmSync(temp);
  });

  it("screen writes the counts JSON", () => {
    const r = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--out", "/tmp/rulekit-screen.json"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync("/tmp/rulekit-screen.json", "utf8"));
    expect(out.counts.eligible + out.counts.ineligible + out.counts.undetermined).toBe(10);
    rmSync("/tmp/rulekit-screen.json");
  });

  it("screen --report writes bands, the per-criterion table and the sole-disqualifier section", () => {
    const path = "/tmp/rulekit-screen-report.md";
    const r = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--report", path]);
    expect(r.status).toBe(0);
    const md = readFileSync(path, "utf8");
    expect(md).toContain("# Screening report — demo-hf-001-eligibility 1.2.0");
    expect(md).toContain("| Band | Patients | Share |");
    expect(md).toContain("| Criterion | Kind | Sequential | Fails alone | Sole reason |");
    expect(md).toContain("## Sole-disqualifier argument");
    expect(md).toContain("E4 · nyha-class-iv | exclusion | 0 | 0 | 0 |");
    // The three band counts must add up to the cohort.
    const bands = [...md.matchAll(/^\| (?:potentially eligible|screen fail|not evaluable) \| (\d+) \|/gm)].map((m) => Number(m[1]));
    expect(bands).toHaveLength(3);
    expect(bands.reduce((a, b) => a + b, 0)).toBe(10);
    rmSync(path);
  });

  it("screen refuses to run with neither --out nor --report", () => {
    expect(run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]).status).toBe(1);
  });

  it("screen --out JSON is unchanged when --report is also given", () => {
    const json = "/tmp/rulekit-screen-both.json";
    const md = "/tmp/rulekit-screen-both.md";
    const only = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--out", "/tmp/rulekit-screen-only.json"]);
    expect(only.status).toBe(0);
    const both = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--out", json, "--report", md]);
    expect(both.status).toBe(0);
    expect(readFileSync(json, "utf8")).toBe(readFileSync("/tmp/rulekit-screen-only.json", "utf8"));
    for (const f of [json, md, "/tmp/rulekit-screen-only.json"]) rmSync(f);
  });
});
