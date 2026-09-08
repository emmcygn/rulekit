import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../scripts/lib/paths.js";

it("runs the recorded corpus and rejects arguments that could select a live config", () => {
  const scratch = mkdtempSync(join(tmpdir(), "rulekit-recorded-eval-"));
  try {
    // CI runs tests before its build step; exercise the actual compiled harness.
    const build = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], {
      cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000,
    });
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);

    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval-recorded.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        PROMPTFOO_CONFIG_DIR: join(scratch, "promptfoo"),
        PROMPTFOO_DISABLE_TELEMETRY: "0",
        PROMPTFOO_DISABLE_UPDATE: "0",
        IS_TESTING: "false",
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const redirected = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval-recorded.ts", "-c", "evals/promptfooconfig.live.yaml"], {
      cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000,
    });
    expect(redirected.status, `${redirected.stdout}\n${redirected.stderr}`).toBe(2);
    expect(redirected.stderr).toContain("recorded eval takes no arguments");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
