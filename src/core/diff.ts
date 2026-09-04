import type { Criterion, Overall, PatientFacts, RuleSet, Verdict } from "./schema.js";
import { evalPatient } from "./evaluator.js";

function stable(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stable);
  if (x !== null && typeof x === "object") {
    return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  }
  return x;
}

function normalize(c: Criterion): string {
  return JSON.stringify(stable({ ref: c.ref ?? null, kind: c.kind, verbatim: c.verbatim, when: c.when ?? null, unmodeled: c.unmodeled ?? false }));
}

function assertComparable(a: RuleSet, b: RuleSet): void {
  if (a.ruleset !== b.ruleset) throw new Error(`cannot diff unrelated rule sets: "${a.ruleset}" vs "${b.ruleset}"`);
  if (a.factModel !== b.factModel) throw new Error(`cannot diff rule sets using different fact models: "${a.factModel}" vs "${b.factModel}"`);
}

export type StructuralDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  renamed: { from: string; to: string }[];
  reordered: string[];
  metadataChanged: string[];
};

export function structuralDiff(a: RuleSet, b: RuleSet): StructuralDiff {
  assertComparable(a, b);
  const aById = new Map(a.criteria.map((c) => [c.id, c]));
  const bById = new Map(b.criteria.map((c) => [c.id, c]));
  const unmatchedA = a.criteria.filter((c) => !bById.has(c.id));
  const unmatchedB = b.criteria.filter((c) => !aById.has(c.id));
  const renamed: { from: string; to: string }[] = [];
  const consumedB = new Set<string>();
  for (const before of unmatchedA) {
    const available = unmatchedB.filter((after) => !consumedB.has(after.id));
    const exact = available.filter((after) => normalize(before) === normalize(after));
    const byRef = before.ref === undefined ? [] : available.filter((after) => after.ref === before.ref);
    const matches = exact.length === 1 ? exact : byRef;
    if (matches.length === 1) {
      renamed.push({ from: before.id, to: matches[0]!.id });
      consumedB.add(matches[0]!.id);
    }
  }
  const renamedA = new Set(renamed.map((r) => r.from));
  const commonA = a.criteria.filter((c) => bById.has(c.id)).map((c) => c.id);
  const commonB = b.criteria.filter((c) => aById.has(c.id)).map((c) => c.id);
  const reordered = commonA.filter((id, index) => commonB[index] !== id);
  const metadataFields = ["protocol", "status", "effective", "source"] as const;
  return {
    added: unmatchedB.filter((c) => !consumedB.has(c.id)).map((c) => c.id),
    removed: unmatchedA.filter((c) => !renamedA.has(c.id)).map((c) => c.id),
    changed: [
      ...b.criteria.filter((c) => aById.has(c.id) && normalize(aById.get(c.id)!) !== normalize(c)).map((c) => c.id),
      ...renamed.filter((r) => normalize(aById.get(r.from)!) !== normalize(bById.get(r.to)!)).map((r) => r.to),
    ],
    renamed,
    reordered,
    metadataChanged: metadataFields.filter((field) => JSON.stringify(stable(a[field] ?? null)) !== JSON.stringify(stable(b[field] ?? null))),
  };
}

export type Flip = { patient: string; from: Overall; to: Overall; responsible: string[] };

export function behavioralDiff(a: RuleSet, b: RuleSet, corpus: PatientFacts[]): Flip[] {
  assertComparable(a, b);
  const renames = structuralDiff(a, b).renamed;
  const oldIdFor = new Map(renames.map((r) => [r.to, r.from]));
  const renamedOldIds = new Set(renames.map((r) => r.from));
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
      ...eb.results.map((r) => ({ id: r.id, before: aVerdicts.get(r.id) ?? aVerdicts.get(oldIdFor.get(r.id) ?? "") ?? ("pass" as Verdict), after: r.verdict })),
      ...ea.results.filter((r) => !bIds.has(r.id) && !renamedOldIds.has(r.id)).map((r) => ({ id: r.id, before: r.verdict, after: "pass" as Verdict })),
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
  const changes = s.added.length + s.removed.length + s.changed.length + s.renamed.length + s.reordered.length + s.metadataChanged.length;
  if (changes === 0 || a.rulesetVersion !== b.rulesetVersion) return undefined;
  return `${changes} tracked change(s) but both files declare rulesetVersion ${a.rulesetVersion} — bump the version, or anyone tracking versions will not see this amendment`;
}
