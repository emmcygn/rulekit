import { afterAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const tempRoot = resolve(tmpdir());
const tempDir = mkdtempSync(join(tempRoot, "rulekit-cli-"));
const tempPath = (name: string): string => join(tempDir, name);
afterAll(() => {
  if (dirname(resolve(tempDir)) !== tempRoot) throw new Error("refusing to remove a directory outside the test temp root");
  rmSync(tempDir, { recursive: true, force: true });
});

function run(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], { encoding: "utf8" });
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

  it("retains the invalid 1.0.0 artifact and uses its corrigendum as the clean baseline", () => {
    const r = run(["check", "rules/trials/demo-hf-001/ruleset@1.0.0.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("unit-mismatch");
    const corrected = run(["check", "rules/trials/demo-hf-001/ruleset@1.0.1.yaml", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(corrected.status).toBe(0);
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
    const r = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.1.yaml", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rulesetVersion 1.0.1 → 1.2.0");
    expect(r.stdout).toContain("+ added renal-safety");
    expect(r.stdout).toContain("SYN-088");
    // The demo bumps its version, so no governance warning here.
    expect(r.stdout).not.toContain("unbumped-version");
  });

  it("diff rejects content changes without a version bump", () => {
    const r = run(["diff", "rules/trials/demo-hf-001/ruleset.yaml", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(r.stdout).not.toContain("unbumped-version"); // identical files: no change
    const temp = tempPath("rulekit-unbumped.yaml");
    writeFileSync(temp, readFileSync("rules/trials/demo-hf-001/ruleset@1.0.1.yaml", "utf8").replace("windowDays: 14", "windowDays: 21"));
    const same = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.1.yaml", temp, "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(same.status).toBe(1);
    expect(same.stdout).toContain("ERROR invalid-version-bump");
    expect(same.stdout).toContain("both files declare rulesetVersion 1.0.1");
    rmSync(temp);
  });

  it("diff rejects regressed versions and behavior changes in patch releases", () => {
    const regression = tempPath("rulekit-regressed.yaml");
    writeFileSync(regression, readFileSync("rules/trials/demo-hf-001/ruleset.yaml", "utf8").replace("rulesetVersion: 1.2.0", "rulesetVersion: 1.0.0"));
    const backwards = run(["diff", "rules/trials/demo-hf-001/ruleset.yaml", regression, "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(backwards.status).toBe(1);
    expect(backwards.stdout).toContain("rulesetVersion regressed from 1.2.0 to 1.0.0");

    const patch = tempPath("rulekit-patch-change.yaml");
    writeFileSync(patch, readFileSync("rules/trials/demo-hf-001/ruleset@1.0.1.yaml", "utf8")
      .replace("rulesetVersion: 1.0.1", "rulesetVersion: 1.0.2")
      .replace("windowDays: 14", "windowDays: 21"));
    const tooSmall = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.1.yaml", patch, "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(tooSmall.status).toBe(1);
    expect(tooSmall.stdout).toContain("criterion behavior or identity changed in patch release");

    const renamed = tempPath("rulekit-renamed-minor.yaml");
    writeFileSync(renamed, readFileSync("rules/trials/demo-hf-001/ruleset@1.0.1.yaml", "utf8")
      .replace("rulesetVersion: 1.0.1", "rulesetVersion: 1.1.0")
      .replace("id: age-min", "id: age-min-renamed"));
    const tooSmallForRename = run(["diff", "rules/trials/demo-hf-001/ruleset@1.0.1.yaml", renamed, "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml"]);
    expect(tooSmallForRename.status).toBe(1);
    expect(tooSmallForRename.stdout).toContain("requires a major bump");
    for (const file of [regression, patch, renamed]) rmSync(file);
  });

  it("screen writes reproducibility and modeling metadata with every evaluation", () => {
    const r = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--as-of", "2026-09-05", "--out", tempPath("rulekit-screen.json")]);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync(tempPath("rulekit-screen.json"), "utf8"));
    expect(out.counts.eligible + out.counts.ineligible + out.counts.undetermined).toBe(10);
    expect(out.metadata).toMatchObject({
      schemaVersion: "rulekit-screen/v1",
      engine: { version: "0.2.0" },
      ruleset: { id: "demo-hf-001-eligibility", version: "1.2.0" },
      factModel: { id: "patient-facts/v1" },
      input: { kind: "corpus", patientCount: 10 },
      evaluation: { asOf: "2026-09-05" },
      modeling: {
        status: "fully-modeled",
        declarationHash: null,
        criteria: { total: 6, modeled: 6, partial: 0, unmodeled: 0 },
        partialCriteria: [],
        unmodeledCriteria: [],
      },
      warnings: [],
    });
    expect(out.metadata.engine).toHaveProperty("commit");
    expect(out.metadata.evaluation.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const hash of [out.metadata.ruleset.contentHash, out.metadata.factModel.contentHash, out.metadata.input.contentHash, out.patients[0].metadata.inputHash]) {
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(out.patients[0].metadata).toMatchObject({
      engine: out.metadata.engine,
      ruleset: out.metadata.ruleset,
      factModel: out.metadata.factModel,
      evaluation: out.metadata.evaluation,
      modelingStatus: "fully-modeled",
      partialCriteria: [],
      unmodeledCriteria: [],
      warnings: [],
    });
    rmSync(tempPath("rulekit-screen.json"));
  });

  it("screen exposes partial rulesets and unmodeled criteria as machine-visible warnings", () => {
    const path = tempPath("rulekit-screen-partial.json");
    const r = run(["screen", "rules/trials/commander-hf/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--out", path]);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync(path, "utf8"));
    expect(out.metadata.modeling.status).toBe("partial");
    expect(out.metadata.modeling.declarationHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(out.metadata.modeling.partialCriteria.map((criterion: { id: string }) => criterion.id)).toEqual([
      "significant-coronary-artery-disease", "concomitant-disease",
    ]);
    expect(out.metadata.modeling.unmodeledCriteria).toEqual([
      "decompensation-index-event", "medically-stable", "bleeding-risk", "planned-iv-inotropes",
    ]);
    expect(out.metadata.warnings).toEqual([
      expect.objectContaining({ code: "partial-criteria", criteria: ["significant-coronary-artery-disease", "concomitant-disease"] }),
      expect.objectContaining({ code: "unmodeled-criteria", criteria: out.metadata.modeling.unmodeledCriteria }),
    ]);
    expect(out.patients.every((patient: { metadata: { warnings: string[] } }) =>
      patient.metadata.warnings.includes("partial-criteria") && patient.metadata.warnings.includes("unmodeled-criteria"))).toBe(true);
    rmSync(path);
  });

  it("screen report front matter and body both warn when the ruleset is partial", () => {
    const path = tempPath("rulekit-screen-partial.md");
    const r = run(["screen", "rules/trials/commander-hf/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--report", path]);
    expect(r.status).toBe(0);
    const report = readFileSync(path, "utf8");
    expect(report).toContain('modelingStatus: "partial"');
    expect(report).toContain('warnings: ["partial-criteria","unmodeled-criteria"]');
    expect(report).toContain("**PARTIAL RULESET WARNING:** 2 criteria are partially translated");
    expect(report).toContain("4 are unmodeled");
    expect(report).toContain("does not verify approval or regulatory compliance");
    rmSync(path);
  });

  it("screen rejects an invalid evaluation as-of date", () => {
    const r = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--as-of", "2026-02-30", "--out", tempPath("unused.json")]);
    expect(r.status).toBe(1);
  });

  it("screen --report writes bands, the per-criterion table and the sole-disqualifier section", () => {
    const path = tempPath("rulekit-screen-report.md");
    const r = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--report", path]);
    expect(r.status).toBe(0);
    const md = readFileSync(path, "utf8");
    expect(md).toContain("# Screening report — demo-hf-001-eligibility 1.2.0");
    expect(md).toContain('schemaVersion: "rulekit-screen-report/v1"');
    expect(md).toMatch(/rulesetHash: "sha256:[0-9a-f]{64}"/);
    expect(md).toContain('modelingStatus: "fully-modeled"');
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

  it("screen --report does not change the JSON payload except for its run timestamp", () => {
    const json = tempPath("rulekit-screen-both.json");
    const md = tempPath("rulekit-screen-both.md");
    const only = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--out", tempPath("rulekit-screen-only.json")]);
    expect(only.status).toBe(0);
    const both = run(["screen", "rules/trials/demo-hf-001/ruleset.yaml", "--corpus", "fixtures/patients", "--fact-model", "packs/trials/fact-model.yaml", "--out", json, "--report", md]);
    expect(both.status).toBe(0);
    const jsonOnly = JSON.parse(readFileSync(tempPath("rulekit-screen-only.json"), "utf8"));
    const jsonBoth = JSON.parse(readFileSync(json, "utf8"));
    delete jsonOnly.metadata.evaluation.timestamp;
    delete jsonBoth.metadata.evaluation.timestamp;
    for (const patient of jsonOnly.patients) delete patient.metadata.evaluation.timestamp;
    for (const patient of jsonBoth.patients) delete patient.metadata.evaluation.timestamp;
    expect(jsonBoth).toEqual(jsonOnly);
    for (const f of [json, md, tempPath("rulekit-screen-only.json")]) rmSync(f);
  });
});
