/**
 * CI can only be red for real reasons.
 *
 * `npm run <script>` from the wrong working directory fails with "missing
 * script" however healthy the code is, and the failure looks identical to a
 * genuine regression. This walks .github/workflows/ci.yml and checks every
 * script a job runs is declared in the package.json that job actually runs in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");

type Step = { run?: string; uses?: string };
type Job = { defaults?: { run?: { "working-directory"?: string } }; steps: Step[] };
type Workflow = { jobs: Record<string, Job> };

const workflow = parseYaml(readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")) as Workflow;

const scriptsIn = (dir: string): Record<string, string> =>
  (JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};

/** `npm run x`, `npm test`, `npm ci`, `npm install` -> the script name, or null. */
function scriptName(run: string): string | null {
  const cmd = run.trim();
  const explicit = /^npm run ([\w:-]+)/.exec(cmd);
  if (explicit) return explicit[1]!;
  if (/^npm test\b/.test(cmd)) return "test";
  return null; // npm ci / npm install / anything else
}

describe("ci.yml", () => {
  const jobs = Object.entries(workflow.jobs);

  it("declares at least the three jobs the repo needs", () => {
    expect(jobs.map(([name]) => name).sort()).toEqual(["review-pane", "test", "workbench"]);
  });

  it.each(jobs)("every script job '%s' runs exists in the package.json it runs in", (name, job) => {
    const dir = job.defaults?.run?.["working-directory"] ?? ".";
    const declared = scriptsIn(dir);
    const missing = job.steps
      .map((s) => (s.run === undefined ? null : scriptName(s.run)))
      .filter((s): s is string => s !== null)
      .filter((s) => declared[s] === undefined);
    expect(missing, `job '${name}' (working-directory: ${dir})`).toEqual([]);
  });

  it("the facts gates run in the root job, where their scripts live", () => {
    const root = workflow.jobs["test"]!;
    const runs = root.steps.map((s) => s.run).filter((r): r is string => r !== undefined);
    expect(root.defaults?.run?.["working-directory"]).toBeUndefined();
    for (const script of ["facts:check", "facts:eval", "eval"]) {
      expect(runs).toContain(`npm run ${script}`);
      expect(scriptsIn(".")[script]).toBeDefined();
    }
    // ...and are gone from the web job, which has no such scripts.
    const web = workflow.jobs["workbench"]!;
    expect(web.steps.map((s) => s.run)).not.toContain("npm run facts:check");
  });
});
