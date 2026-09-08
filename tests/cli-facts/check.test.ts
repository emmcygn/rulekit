import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(repoRoot, "src", "cli-facts", "index.ts");

type Run = { code: number; stdout: string; stderr: string };

function facts(...args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("facts check", () => {
  it("exits 0 on a clean fixture", () => {
    const r = facts("check", "tests/fixtures/facts-good");
    expect(r.stdout).toContain("1 file(s) OK");
    expect(r.code).toBe(0);
  });

  it("exits 0 on the shipped corpus (dogfooding)", () => {
    const r = facts("check", "corpus/facts");
    expect(r.stdout).toContain("10 file(s) OK");
    expect(r.code).toBe(0);
  });

  it("exits 1 on the bad fixture", () => {
    expect(facts("check", "tests/fixtures/facts-bad").code).toBe(1);
  });

  it("catches a fabricated quote", () => {
    const r = facts("check", "tests/fixtures/facts-bad/SYN-042.yaml");
    expect(r.stdout).toMatch(/nyha_class.*no longer appears verbatim/);
  });

  it("catches a fact name that is not in the fact model", () => {
    const r = facts("check", "tests/fixtures/facts-bad/SYN-042.yaml");
    expect(r.stdout).toMatch(/frailty_idx.*not declared in fact model/);
  });

  it("catches a unit that does not match the declaration", () => {
    const r = facts("check", "tests/fixtures/facts-bad/SYN-042.yaml");
    expect(r.stdout).toMatch(/lvef.*"ml" does not match declared unit "%"/);
  });

  it("flags a measurement outside its declared window", () => {
    const r = facts("check", "tests/fixtures/facts-bad/SYN-042.yaml");
    expect(r.stdout).toMatch(/egfr.*outside the declared 90d window/);
  });

  it("catches a quote taken from another patient's chart", () => {
    const r = facts("check", "tests/fixtures/facts-bad/SYN-007.yaml");
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/lvef.*'echo-2026-03-12' is SYN-042's chart, not SYN-007's/);
  });

  it("reports a schema error with the file it came from", () => {
    const r = facts("check", "tests/fixtures/facts-bad/SYN-902.yaml");
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/SYN-902\.yaml.*reviewedBy/);
  });

  it("reports every problem in one run rather than stopping at the first", () => {
    const r = facts("check", "tests/fixtures/facts-bad");
    expect(r.stdout).toMatch(/6 problem\(s\) in 3 file\(s\)/);
  });

  it("measures recency against the file's asOf, not today", () => {
    // SYN-042's egfr is 43 days before its asOf of 2026-03-12 and inside its
    // 90-day window — but well over 90 days before the real today. If the check
    // used the wall clock this would fail.
    expect(facts("check", "tests/fixtures/facts-good").code).toBe(0);
  });

  it("errors clearly on a missing directory", () => {
    const r = facts("check", "tests/fixtures/nope");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no such directory/);
  });
});

describe("facts eval", () => {
  it("prints the report and exits 0", () => {
    const r = facts("eval");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("extraction eval — 10 notes");
    expect(r.stdout).toContain("confidence calibration");
  });

  it("exits 1 when precision falls below the CI floor", () => {
    const r = facts("eval", "--min-precision", "0.999");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/precision .* < 0\.999/);
  });

  it("passes a floor the recorded run clears", () => {
    expect(facts("eval", "--min-precision", "0.95", "--min-recall", "0.95").code).toBe(0);
  });

  it.each([
    ["prompt", (recording: Record<string, unknown>) => {
      recording.promptSha256 = "0".repeat(64);
    }],
    ["model", (recording: Record<string, unknown>) => {
      recording.model = "different-model";
    }],
  ])("fails before scoring when a recording's %s binding is stale", (_field, mutate) => {
    const scratch = mkdtempSync(join(tmpdir(), "rulekit-recordings-"));
    try {
      cpSync(join(repoRoot, "evals", "recorded"), scratch, { recursive: true });
      const path = join(scratch, "echo-2026-03-12.json");
      const recording = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      mutate(recording);
      writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);

      const result = facts("eval", "--recorded", scratch);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/stale or mismatched recording/);
    } finally {
      rmSync(scratch, { recursive: true });
    }
  });
});
