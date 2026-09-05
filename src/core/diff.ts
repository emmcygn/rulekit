import type { Criterion, Overall, PatientFacts, RuleSet, Verdict } from "./schema.js";
import { evalPatientUnsafe } from "./evaluator.js";

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

/** Content stable enough to identify an exact rename even when the protocol ref also moved. */
function renameIdentity(c: Criterion): string {
  return JSON.stringify(stable({ kind: c.kind, verbatim: c.verbatim, when: c.when ?? null, unmodeled: c.unmodeled ?? false }));
}

/**
 * Shape used for the weaker, ref-based rename fallback. Literal thresholds,
 * code values and prose may move during an amendment; the condition topology,
 * facts and operators may not. That prevents a reused protocol ref from
 * turning a wholesale replacement into a rename.
 */
function renameShape(c: Criterion): string {
  const shape = (x: unknown, key?: string): unknown => {
    if (Array.isArray(x)) return key === "values" ? "<values>" : x.map((v) => shape(v));
    if (x !== null && typeof x === "object") {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, shape(v, k)]),
      );
    }
    return key === "value" || key === "windowDays" ? "<literal>" : x;
  };
  return JSON.stringify(stable({ kind: c.kind, when: c.when === undefined ? null : shape(c.when), unmodeled: c.unmodeled ?? false }));
}

type CriterionIndex = {
  byId: Map<string, Criterion>;
  normalized: Map<string, string>;
  identity: Map<string, string>;
  shape: Map<string, string>;
};

function indexCriteria(criteria: readonly Criterion[]): CriterionIndex {
  const byId = new Map<string, Criterion>();
  const normalized = new Map<string, string>();
  const identity = new Map<string, string>();
  const shape = new Map<string, string>();
  for (const c of criteria) {
    byId.set(c.id, c);
    normalized.set(c.id, normalize(c));
    identity.set(c.id, renameIdentity(c));
    shape.set(c.id, renameShape(c));
  }
  return { byId, normalized, identity, shape };
}

function buckets(criteria: readonly Criterion[], signature: Map<string, string>): Map<string, Criterion[]> {
  const out = new Map<string, Criterion[]>();
  for (const c of criteria) {
    const key = signature.get(c.id)!;
    const bucket = out.get(key);
    if (bucket === undefined) out.set(key, [c]);
    else bucket.push(c);
  }
  return out;
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
  const aIndex = indexCriteria(a.criteria);
  const bIndex = indexCriteria(b.criteria);
  const unmatchedA = a.criteria.filter((c) => !bIndex.byId.has(c.id));
  const unmatchedB = b.criteria.filter((c) => !aIndex.byId.has(c.id));
  const renamed: { from: string; to: string }[] = [];
  const consumedA = new Set<string>();
  const consumedB = new Set<string>();

  // Exact identities are paired only when unique on both sides. Ambiguous
  // duplicates stay added/removed instead of being paired by iteration order.
  const exactA = buckets(unmatchedA, aIndex.identity);
  const exactB = buckets(unmatchedB, bIndex.identity);
  for (const before of unmatchedA) {
    const key = aIndex.identity.get(before.id)!;
    const oldBucket = exactA.get(key)!;
    const newBucket = exactB.get(key);
    if (oldBucket.length === 1 && newBucket?.length === 1) {
      const after = newBucket[0]!;
      renamed.push({ from: before.id, to: after.id });
      consumedA.add(before.id);
      consumedB.add(after.id);
    }
  }

  // A stable, unique protocol ref can align a retuned/reworded criterion, but
  // only when its semantic shape survived. This is an indexed O(C) fallback.
  const remainingA = unmatchedA.filter((c) => !consumedA.has(c.id));
  const remainingB = unmatchedB.filter((c) => !consumedB.has(c.id));
  const byRefA = new Map<string, Criterion[]>();
  const byRefB = new Map<string, Criterion[]>();
  for (const c of remainingA) {
    if (c.ref === undefined) continue;
    const bucket = byRefA.get(c.ref);
    if (bucket === undefined) byRefA.set(c.ref, [c]);
    else bucket.push(c);
  }
  for (const c of remainingB) {
    if (c.ref === undefined) continue;
    const bucket = byRefB.get(c.ref);
    if (bucket === undefined) byRefB.set(c.ref, [c]);
    else bucket.push(c);
  }
  for (const before of remainingA) {
    if (before.ref === undefined) continue;
    const oldBucket = byRefA.get(before.ref)!;
    const newBucket = byRefB.get(before.ref);
    if (
      oldBucket.length === 1 &&
      newBucket?.length === 1 &&
      aIndex.shape.get(before.id) === bIndex.shape.get(newBucket[0]!.id)
    ) {
      const after = newBucket[0]!;
      renamed.push({ from: before.id, to: after.id });
      consumedA.add(before.id);
      consumedB.add(after.id);
    }
  }

  const commonA = a.criteria.filter((c) => bIndex.byId.has(c.id)).map((c) => c.id);
  const commonB = b.criteria.filter((c) => aIndex.byId.has(c.id)).map((c) => c.id);
  const reordered = commonA.filter((id, index) => commonB[index] !== id);
  const metadataFields = ["protocol", "status", "effective", "source"] as const;
  return {
    added: unmatchedB.filter((c) => !consumedB.has(c.id)).map((c) => c.id),
    removed: unmatchedA.filter((c) => !consumedA.has(c.id)).map((c) => c.id),
    changed: [
      ...b.criteria.filter((c) => aIndex.byId.has(c.id) && aIndex.normalized.get(c.id) !== bIndex.normalized.get(c.id)).map((c) => c.id),
      ...renamed.filter((r) => aIndex.normalized.get(r.from) !== bIndex.normalized.get(r.to)).map((r) => r.to),
    ],
    renamed,
    reordered,
    metadataChanged: metadataFields.filter((field) => JSON.stringify(stable(a[field] ?? null)) !== JSON.stringify(stable(b[field] ?? null))),
  };
}

export type Flip = { patient: string; from: Overall; to: Overall; responsible: string[] };

export function behavioralDiff(
  a: RuleSet,
  b: RuleSet,
  corpus: PatientFacts[],
  structural: StructuralDiff = structuralDiff(a, b),
): Flip[] {
  assertComparable(a, b);
  const renames = structural.renamed;
  const oldIdFor = new Map(renames.map((r) => [r.to, r.from]));
  const renamedOldIds = new Set(renames.map((r) => r.from));
  const flips: Flip[] = [];
  for (const p of corpus) {
    const ea = evalPatientUnsafe(a, p);
    const eb = evalPatientUnsafe(b, p);
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
