import type { Criterion, Overall, PatientFacts, RuleSet, Verdict } from "./schema.js";
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
    // Attribution is *any* verdict change, not just a change in fail-ness.
    // `unknown → pass` is the commonest flip direction on a corpus with
    // unmodeled criteria, and `eligible → undetermined` is the one that matters
    // for safety; both were previously invisible, so every such flip printed an
    // empty attribution. Fail-ness changes are still listed first, so the
    // criterion that removed or admitted a patient leads the message.
    //
    // A criterion present in only one version is read as `pass` in the other:
    // a criterion that does not exist constrains nobody. That is what keeps an
    // *added* criterion the patient passes out of the attribution, and what
    // lets a *removed* one — invisible in the new version's results — be named.
    const aVerdicts = new Map(ea.results.map((r) => [r.id, r.verdict]));
    const bIds = new Set(eb.results.map((r) => r.id));
    const moves: { id: string; before: Verdict; after: Verdict }[] = [
      ...eb.results.map((r) => ({ id: r.id, before: aVerdicts.get(r.id) ?? ("pass" as Verdict), after: r.verdict })),
      ...ea.results.filter((r) => !bIds.has(r.id)).map((r) => ({ id: r.id, before: r.verdict, after: "pass" as Verdict })),
    ];
    const changed = moves.filter((m) => m.before !== m.after);
    const flipsFailness = (m: { before: Verdict; after: Verdict }): boolean => (m.after === "fail") !== (m.before === "fail");
    const responsible = [...changed.filter(flipsFailness), ...changed.filter((m) => !flipsFailness(m))].map((m) => m.id);
    flips.push({ patient: p.patient, from: ea.overall, to: eb.overall, responsible });
  }
  return flips;
}

/**
 * Amendment control is the pitch, and semver on the rule set is how it is
 * tracked — so a content change under a standing `rulesetVersion` is a
 * governance defect, not a style one. `rules diff` says so out loud; nothing
 * else in the toolchain would.
 */
export function versionWarning(a: RuleSet, b: RuleSet, s: StructuralDiff): string | undefined {
  const changes = s.added.length + s.removed.length + s.changed.length;
  if (changes === 0 || a.rulesetVersion !== b.rulesetVersion) return undefined;
  return `${changes} criterion change(s) but both files declare rulesetVersion ${a.rulesetVersion} — bump the version, or anyone tracking versions will not see this amendment`;
}
