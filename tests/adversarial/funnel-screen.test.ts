/**
 * Adversarial probes — screen counts vs the workbench funnel (attack surface 7).
 *
 * `rules screen` (src/cli/index.ts) buckets each patient by `evalPatient`'s
 * overall, which is ORDER-INDEPENDENT: any fail anywhere → ineligible.
 * `computeFunnel` (web/src/funnel/compute.ts) drains the pool in criterion
 * order and files a patient under the FIRST criterion that removes them, with
 * unknown removing as decisively as fail. The two therefore disagree about the
 * same cohort, and neither surface says so.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evalPatient } from "../../src/core/evaluator.js";
import { parsePatient, parseRuleSet, type Overall, type RuleSet } from "../../src/core/schema.js";
import { computeFunnel, cohortCounts } from "../../web/src/funnel/compute.js";

const ROOT = join(import.meta.dirname, "..", "..");
const corpus = (dir: string) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parsePatient(readFileSync(join(ROOT, dir, f), "utf8")));

const counts = (rs: RuleSet, patients: ReturnType<typeof corpus>) => {
  const out: Record<Overall, number> = { eligible: 0, ineligible: 0, undetermined: 0 };
  for (const p of patients) out[evalPatient(rs, p).overall] += 1;
  return out;
};

describe("E1 — the CLI and the funnel report different screen-fail counts for one cohort", () => {
  const rs = parseRuleSet(readFileSync(join(ROOT, "rules/trials/commander-hf/ruleset.yaml"), "utf8"));
  const patients = corpus("corpus/normalized");
  const evals = patients.map((p) => evalPatient(rs, p));

  it("`rules screen` on corpus/normalized: 0 eligible / 97 ineligible / 3 undetermined", () => {
    expect(counts(rs, patients)).toEqual({ eligible: 0, ineligible: 97, undetermined: 3 });
  });

  it("the funnel's headline numbers do not match those", () => {
    const cohort = cohortCounts(evals);
    // Same patients, same rule set, same engine — different story.
    expect(cohort.screenFail).not.toBe(97);
    expect(cohort.screenFail + cohort.notEvaluable + cohort.potentiallyEligible).toBe(patients.length);
    // Recorded for the report:
    expect(cohort).toMatchInlineSnapshot(`
      {
        "notEvaluable": 6,
        "potentiallyEligible": 2,
        "screenFail": 92,
      }
    `);
  });

  it("the funnel offers 2 'potentially eligible' patients where the CLI reports 0 eligible", () => {
    const cohort = cohortCounts(evals);
    expect(cohort.potentiallyEligible).toBe(2);
    expect(counts(rs, patients).eligible).toBe(0);
    // The two survivors are undetermined in the engine — they only reach
    // `remaining` because unmodeled criteria do not drain the pool. Defensible
    // as "potentially", but it is the number a feasibility reader quotes, and
    // it is 2 in the workbench and 0 in the CLI for the same cohort and rules.
    const survivors = computeFunnel(evals);
    const remaining = survivors.rows.filter((r) => !r.unmodeled).at(-1)!.patients.pass;
    expect(remaining.every((p) => evals.find((e) => e.patient === p)!.overall === "undetermined")).toBe(true);
  });

  it("5 patients the CLI calls ineligible are filed by the funnel as 'not evaluable'", () => {
    const f = computeFunnel(evals);
    const removedAsUnknown = new Set<string>();
    for (const row of f.rows) if (!row.unmodeled) for (const p of row.patients.unknown) removedAsUnknown.add(p);
    const ineligible = new Set(evals.filter((e) => e.overall === "ineligible").map((e) => e.patient));
    const mislabelled = [...removedAsUnknown].filter((p) => ineligible.has(p));
    // MISLEADS: "we could not evaluate them" reads as a data-quality problem to
    // fix; the engine already knows these patients definitively fail a
    // criterion further down the list.
    expect(mislabelled.length).toBe(5);
  });
});

describe("E2 — the same divergence in miniature, and it is order-sensitive", () => {
  const mk = (order: "unknown-first" | "fail-first"): RuleSet => {
    const renal = {
      id: "renal",
      kind: "inclusion" as const,
      verbatim: "eGFR >= 30",
      when: { fact: "egfr", op: "gte" as const, value: 30 },
    };
    const age = {
      id: "paediatric-exclusion",
      kind: "exclusion" as const,
      verbatim: "Under 18",
      when: { fact: "age", op: "lt" as const, value: 18 },
    };
    return {
      ruleset: "order",
      rulesetVersion: "1.0.0",
      factModel: "probe/v1",
      criteria: order === "unknown-first" ? [renal, age] : [age, renal],
    };
  };

  // 12 years old, no eGFR on file: definitively too young, renal status unknown.
  const child = { patient: "CHILD", facts: { age: 12 } };

  it("evalPatient says ineligible regardless of criterion order", () => {
    expect(evalPatient(mk("unknown-first"), child).overall).toBe("ineligible");
    expect(evalPatient(mk("fail-first"), child).overall).toBe("ineligible");
  });

  it("the funnel says 'not evaluable' or 'screen fail' depending purely on YAML order", () => {
    const a = cohortCounts([evalPatient(mk("unknown-first"), child)]);
    const b = cohortCounts([evalPatient(mk("fail-first"), child)]);
    expect(a).toEqual({ potentiallyEligible: 0, screenFail: 0, notEvaluable: 1 });
    expect(b).toEqual({ potentiallyEligible: 0, screenFail: 1, notEvaluable: 0 });
    // BUG (attribution): reordering two criteria — a no-op for the engine —
    // moves a patient between the two headline buckets of the demo's main chart.
  });
});

describe("E3 — per-criterion funnel columns are internally consistent (attack failed)", () => {
  const rs = parseRuleSet(readFileSync(join(ROOT, "rules/trials/commander-hf/ruleset.yaml"), "utf8"));
  const evals = corpus("corpus/normalized").map((p) => evalPatient(rs, p));

  it("rows drain the pool exactly once and the totals close", () => {
    const f = computeFunnel(evals);
    let pool = f.n;
    for (const row of f.rows) {
      expect(row.entering).toBe(pool);
      expect(row.pass + row.fail + row.unknown).toBe(row.entering);
      if (!row.unmodeled) pool = row.pass;
    }
    expect(pool).toBe(f.remaining);
    expect(f.rows.filter((r) => !r.unmodeled).reduce((n, r) => n + r.removedSequential, 0)).toBe(f.screenFail);
    expect(f.n).toBe(f.screenFail + f.notEvaluable + f.remaining);
  });

  it("failsAlone (order-free) is >= removedSequential for every criterion", () => {
    for (const row of computeFunnel(evals).rows) {
      expect(row.failsAlone).toBeGreaterThanOrEqual(row.removedSequential);
    }
  });
});
