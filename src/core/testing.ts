import type { Condition, Criterion, PatientFacts, RuleSet, TestSuite, Verdict } from "./schema.js";
import { evalPatientUnsafe } from "./evaluator.js";
import { andTri, notTri, orTri, type Tri } from "./tri.js";

export type CaseResult = { name: string; ok: boolean; mismatches: { key: string; expected: string; actual: string }[] };
export type Coverage = { criterion: string; pass: number; fail: number; unknown: number; gaps: string[] };
export type SuiteResult = { cases: CaseResult[]; ok: boolean; coverage: Coverage[] };
export type DeadRule = { criterion: string; reason: string };

function possibleConditionResults(cond: Condition): Set<Tri> {
  if ("all" in cond || "any" in cond) {
    const children = ("all" in cond ? cond.all : cond.any).map(possibleConditionResults);
    let possible = new Set<Tri>(["all" in cond ? "true" : "false"]);
    for (const child of children) {
      possible = new Set([...possible].flatMap((left) => [...child].map((right) => "all" in cond ? andTri([left, right]) : orTri([left, right]))));
    }
    return possible;
  }
  if ("not" in cond) return new Set([...possibleConditionResults(cond.not)].map(notTri));
  return cond.op === "exists" ? new Set<Tri>(["true", "unknown"]) : new Set<Tri>(["true", "false", "unknown"]);
}

function possibleVerdicts(c: Criterion): Set<Verdict> {
  if (c.when === undefined || c.unmodeled === true) return new Set(["unknown"]);
  return new Set([...possibleConditionResults(c.when)].map((result): Verdict => {
    if (result === "unknown") return "unknown";
    if (c.kind === "inclusion") return result === "true" ? "pass" : "fail";
    return result === "true" ? "fail" : "pass";
  }));
}

export function runSuite(rs: RuleSet, suite: TestSuite): SuiteResult {
  const counts = new Map<string, { pass: number; fail: number; unknown: number }>(
    rs.criteria.map((c) => [c.id, { pass: 0, fail: 0, unknown: 0 }]),
  );
  const cases: CaseResult[] = suite.cases.map((tc) => {
    const ev = evalPatientUnsafe(rs, { patient: tc.name, facts: tc.facts });
    const actualById: Record<string, string> = { overall: ev.overall };
    for (const r of ev.results) {
      actualById[r.id] = r.verdict;
      counts.get(r.id)![r.verdict] += 1;
    }
    const mismatches = Object.entries(tc.expect)
      .filter(([key, expected]) => actualById[key] !== expected)
      .map(([key, expected]) => ({ key, expected, actual: actualById[key] ?? "(no such criterion)" }));
    if (tc.expect.overall === undefined) {
      mismatches.unshift({ key: "overall", expected: "(required)", actual: ev.overall });
    }
    return { name: tc.name, ok: mismatches.length === 0, mismatches };
  });
  const coverage: Coverage[] = rs.criteria.map((c) => {
    const n = counts.get(c.id)!;
    const gaps: string[] = [];
    if (c.unmodeled !== true) {
      const possible = possibleVerdicts(c);
      if (possible.has("pass") && n.pass === 0) gaps.push("never passes");
      if (possible.has("fail") && n.fail === 0) gaps.push("never fails");
    }
    return { criterion: c.id, ...n, gaps };
  });
  return { cases, ok: cases.every((c) => c.ok), coverage };
}

export function deadRules(rs: RuleSet, corpus: PatientFacts[]): DeadRule[] {
  if (corpus.length === 0) return [];
  const counts = new Map<string, { pass: number; fail: number; unknown: number }>(rs.criteria.map((c) => [c.id, { pass: 0, fail: 0, unknown: 0 }]));
  for (const p of corpus) {
    for (const r of evalPatientUnsafe(rs, p).results) {
      counts.get(r.id)![r.verdict] += 1;
    }
  }
  return rs.criteria
    .filter((c) => c.unmodeled !== true && possibleVerdicts(c).has("fail") && counts.get(c.id)!.fail === 0)
    .map((c) => ({
      criterion: c.id,
      reason: counts.get(c.id)!.unknown === corpus.length
        ? `always unknown on the corpus (${corpus.length} of ${corpus.length} patients); the required fact may be absent or invalid`
        : `${c.kind === "exclusion" ? "never fires" : "never fails"} on the corpus (0 of ${corpus.length} patients; ${counts.get(c.id)!.unknown} unknown)`,
    }));
}
