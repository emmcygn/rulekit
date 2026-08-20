import type { Criterion, Overall, PatientFacts, RuleSet } from "./schema.js";
import { evalPatient } from "./evaluator.js";

function normalize(c: Criterion): string {
  const stable = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(stable);
    if (x !== null && typeof x === "object") {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
    }
    return x;
  };
  return JSON.stringify(stable({ kind: c.kind, when: c.when ?? null, unmodeled: c.unmodeled ?? false }));
}

export type StructuralDiff = { added: string[]; removed: string[]; changed: string[] };

export function structuralDiff(a: RuleSet, b: RuleSet): StructuralDiff {
  const aById = new Map(a.criteria.map((c) => [c.id, c]));
  const bById = new Map(b.criteria.map((c) => [c.id, c]));
  return {
    added: b.criteria.filter((c) => !aById.has(c.id)).map((c) => c.id),
    removed: a.criteria.filter((c) => !bById.has(c.id)).map((c) => c.id),
    changed: b.criteria.filter((c) => aById.has(c.id) && normalize(aById.get(c.id)!) !== normalize(c)).map((c) => c.id),
  };
}

export type Flip = { patient: string; from: Overall; to: Overall; responsible: string[] };

export function behavioralDiff(a: RuleSet, b: RuleSet, corpus: PatientFacts[]): Flip[] {
  const flips: Flip[] = [];
  for (const p of corpus) {
    const ea = evalPatient(a, p);
    const eb = evalPatient(b, p);
    if (ea.overall === eb.overall) continue;
    const aVerdicts = new Map(ea.results.map((r) => [r.id, r.verdict]));
    const responsible = eb.results
      .filter((r) => (r.verdict === "fail") !== (aVerdicts.get(r.id) === "fail"))
      .map((r) => r.id);
    flips.push({ patient: p.patient, from: ea.overall, to: eb.overall, responsible });
  }
  return flips;
}
