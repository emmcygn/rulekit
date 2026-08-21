import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

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
  it("check exits 1 on the seeded conflict and prints the band", () => {
    const r = run(["check", "rules/trials/demo-hf-001/ruleset.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("contradictory band [30, 45)");
    expect(r.stdout).toContain("unit-mismatch");
  });

  it("check exits 0 on the clean pre-amendment version", () => {
    const r = run(["check", "rules/trials/demo-hf-001/ruleset@1.0.0.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(0);
  });

  it("a fully clean check states the scope of the analysis rather than implying a proof", () => {
    const r = run(["check", "rules/trials/commander-hf/ruleset.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "0 conflict(s), 0 warning(s) — static analysis covers single-fact interval logic; it is not a proof of consistency.",
    );
  });

  it("a run with findings prints the plain counts, not the scope sentence", () => {
    const r = run(["check", "rules/trials/demo-hf-001/ruleset.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.stdout).toContain("1 conflict(s), 1 warning(s)");
    expect(r.stdout).not.toContain("not a proof of consistency");
  });

  it("test runs the suite with coverage", () => {
    const r = run(["test", "rules/trials/demo-hf-001", "--fact-model", "packs/trials/fact-model.yaml", "--corpus", "fixtures/patients"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("10/10 cases pass");
    expect(r.stdout).toMatch(/coverage/i);
  });

  it("diff prints the version pair, structural changes and flips", () => {
    const r = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.0.yaml", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rulesetVersion 1.0.0 → 1.1.0");
    expect(r.stdout).toContain("+ added renal-safety");
    expect(r.stdout).toContain("SYN-088");
    // The demo bumps its version, so no governance warning here.
    expect(r.stdout).not.toContain("unbumped-version");
  });

  it("diff warns when the content moved but the version did not", () => {
    const r = run(["diff", "rules/trials/demo-hf-001/ruleset.yaml", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients"]);
    expect(r.stdout).not.toContain("unbumped-version"); // identical files: no change
    const same = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.0.yaml", "rules/trials/commander-hf/ruleset.yaml", "--corpus", "fixtures/patients"]);
    expect(same.stdout).toContain("! WARNING unbumped-version");
    expect(same.stdout).toContain("both files declare rulesetVersion 1.0.0");
  });

  it("screen writes the counts JSON", () => {
    const r = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--out", "/tmp/rulekit-screen.json"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync("/tmp/rulekit-screen.json", "utf8"));
    expect(out.counts.eligible + out.counts.ineligible + out.counts.undetermined).toBe(10);
    rmSync("/tmp/rulekit-screen.json");
  });
});
