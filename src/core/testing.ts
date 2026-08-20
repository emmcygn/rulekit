import type { PatientFacts, RuleSet, TestSuite } from "./schema.js";
import { evalPatient } from "./evaluator.js";

export type CaseResult = { name: string; ok: boolean; mismatches: { key: string; expected: string; actual: string }[] };
export type Coverage = { criterion: string; pass: number; fail: number; unknown: number; gaps: string[] };
export type SuiteResult = { cases: CaseResult[]; ok: boolean; coverage: Coverage[] };
export type DeadRule = { criterion: string; reason: string };

export function runSuite(rs: RuleSet, suite: TestSuite): SuiteResult {
  const counts = new Map<string, { pass: number; fail: number; unknown: number }>(
    rs.criteria.map((c) => [c.id, { pass: 0, fail: 0, unknown: 0 }]),
  );
  const cases: CaseResult[] = suite.cases.map((tc) => {
    const ev = evalPatient(rs, { patient: tc.name, facts: tc.facts });
    const actualById: Record<string, string> = { overall: ev.overall };
    for (const r of ev.results) {
      actualById[r.id] = r.verdict;
      counts.get(r.id)![r.verdict] += 1;
    }
    const mismatches = Object.entries(tc.expect)
      .filter(([key, expected]) => actualById[key] !== expected)
      .map(([key, expected]) => ({ key, expected, actual: actualById[key] ?? "(no such criterion)" }));
    return { name: tc.name, ok: mismatches.length === 0, mismatches };
  });
  const coverage: Coverage[] = rs.criteria.map((c) => {
    const n = counts.get(c.id)!;
    const gaps: string[] = [];
    if (n.pass === 0) gaps.push("never passes");
    if (n.fail === 0) gaps.push("never fails");
    return { criterion: c.id, ...n, gaps };
  });
  return { cases, ok: cases.every((c) => c.ok), coverage };
}

export function deadRules(rs: RuleSet, corpus: PatientFacts[]): DeadRule[] {
  const fired = new Map<string, number>(rs.criteria.map((c) => [c.id, 0]));
  for (const p of corpus) {
    for (const r of evalPatient(rs, p).results) {
      if (r.verdict === "fail") fired.set(r.id, fired.get(r.id)! + 1);
    }
  }
  return rs.criteria
    .filter((c) => c.unmodeled !== true && fired.get(c.id) === 0)
    .map((c) => ({
      criterion: c.id,
      reason: `${c.kind === "exclusion" ? "never fires" : "never fails"} on the corpus (0 of ${corpus.length} patients)`,
    }));
}
