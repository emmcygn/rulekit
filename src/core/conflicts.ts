import type { Condition, FactModel, Leaf, NumericLeaf, RuleSet } from "./schema.js";
import { FULL, contains, fromLeaf, intersect, isEmpty, fmtInterval, type Interval } from "./interval.js";
import { lintRuleSet, type Finding } from "./lint.js";

const INTERVAL_OPS = new Set(["eq", "gt", "gte", "lt", "lte"]);

function isNumericIntervalLeaf(l: Leaf): l is NumericLeaf {
  return INTERVAL_OPS.has(l.op) && "value" in l && typeof l.value === "number";
}

/** An interval that admits exactly one value, e.g. `[40, 40]` from `eq 40`. */
function pointOf(i: Interval): number | undefined {
  return i.lo === i.hi && !i.loOpen && !i.hiOpen && Number.isFinite(i.lo) ? i.lo : undefined;
}

/** Necessary leaves reachable through `all`; opaque any/not branches are skipped. */
function allChainLeaves(cond: Condition): { leaves: Leaf[]; complete: boolean } {
  if ("any" in cond || "not" in cond) return { leaves: [], complete: false };
  if ("all" in cond) {
    const parts = cond.all.map(allChainLeaves);
    return { leaves: parts.flatMap((p) => p.leaves), complete: parts.every((p) => p.complete) };
  }
  return { leaves: [cond], complete: true };
}

type CodeConstraint = { fact: string; op: "in" | "notIn"; system: string; values: string[] };

type Analysis = {
  /** Per-fact interval from the criterion's `eq/gt/gte/lt/lte` leaves. */
  intervals: Map<string, Interval>;
  /** Per-fact values the criterion's `neq` leaves rule out. */
  neqs: Map<string, number[]>;
  codes: CodeConstraint[];
  fullyAnalyzed: boolean;
};

/** Per-fact intervals for one criterion, or null when not analyzable. */
function criterionIntervals(cond: Condition): Analysis {
  const chain = allChainLeaves(cond);
  const leaves = chain.leaves;
  const intervals = new Map<string, Interval>();
  const neqs = new Map<string, number[]>();
  const codes: CodeConstraint[] = [];
  let nonInterval = 0;
  for (const leaf of leaves) {
    // `neq v` carries no interval of its own (it punches a hole, which is not an
    // interval), but it does decide the one case interval arithmetic can see: an
    // interval already narrowed to the single point `v`.
    if (leaf.op === "neq" && "value" in leaf && typeof leaf.value === "number") {
      nonInterval += 1;
      neqs.set(leaf.fact, [...(neqs.get(leaf.fact) ?? []), leaf.value]);
      continue;
    }
    if (!isNumericIntervalLeaf(leaf)) {
      if ((leaf.op === "in" || leaf.op === "notIn") && "codes" in leaf) {
        codes.push({ fact: leaf.fact, op: leaf.op, system: leaf.codes.system, values: leaf.codes.values });
      }
      nonInterval += 1;
      continue;
    }
    const prev = intervals.get(leaf.fact) ?? FULL;
    intervals.set(leaf.fact, intersect(prev, fromLeaf(leaf.op as "eq" | "gt" | "gte" | "lt" | "lte", leaf.value)));
  }
  return {
    intervals,
    neqs,
    codes,
    fullyAnalyzed: chain.complete && nonInterval === 0,
  };
}

const sameCodeDomain = (a: CodeConstraint, b: CodeConstraint): boolean => a.fact === b.fact && a.system === b.system;
const subset = (a: readonly string[], b: readonly string[]): boolean => a.every((v) => b.includes(v));

export function detectConflicts(rs: RuleSet): Finding[] {
  const out: Finding[] = [];
  const analyzed: ({ id: string; kind: "inclusion" | "exclusion" } & Analysis)[] = [];

  for (const c of rs.criteria) {
    if (c.when === undefined) continue;
    const a = criterionIntervals(c.when);
    if (!a.fullyAnalyzed) {
      out.push({ level: "info", code: "analysis-incomplete", criteria: [c.id], message: `"${c.id}" contains logic outside complete interval analysis; lint and supported local proofs still run, but this criterion is not proven conflict-free` });
    }
    for (const [fact, iv] of a.intervals) {
      if (isEmpty(iv)) {
        out.push({ level: "error", code: "unsatisfiable-criterion", criteria: [c.id], message: `"${c.id}" can never fire: its own constraints on ${fact} intersect to the empty set`, evidence: `${fact}: ${fmtInterval(iv)}` });
        continue;
      }
      const point = pointOf(iv);
      if (point !== undefined && (a.neqs.get(fact) ?? []).includes(point)) {
        out.push({ level: "error", code: "unsatisfiable-criterion", criteria: [c.id], message: `"${c.id}" can never fire: its own constraints on ${fact} admit only ${point}, which its "neq ${point}" leaf rules out`, evidence: `${fact}: ${fmtInterval(iv)} minus {${point}} is the empty set` });
      }
    }
    for (const positive of a.codes.filter((x) => x.op === "in")) {
      for (const negative of a.codes.filter((x) => x.op === "notIn" && sameCodeDomain(x, positive))) {
        if (!subset(positive.values, negative.values)) continue;
        out.push({ level: "error", code: "unsatisfiable-criterion", criteria: [c.id], message: `"${c.id}" can never fire: it requires a ${positive.system} code from {${positive.values.join(",")}} while forbidding that entire set`, evidence: `${positive.fact}: in {${positive.values.join(",")}} ∩ notIn {${negative.values.join(",")}} → empty` });
      }
    }
    if (a.intervals.size > 0 || a.neqs.size > 0 || a.codes.length > 0) analyzed.push({ id: c.id, kind: c.kind, ...a });
  }

  // Necessary code constraints across inclusion criteria can also prove that
  // nobody is eligible: requiring a value from S while forbidding all of S.
  const inclusionCodes = analyzed.filter((x) => x.kind === "inclusion").flatMap((a) => a.codes.map((code) => ({ id: a.id, code })));
  for (const positive of inclusionCodes.filter((x) => x.code.op === "in")) {
    for (const negative of inclusionCodes.filter((x) => x.code.op === "notIn" && x.id !== positive.id && sameCodeDomain(x.code, positive.code))) {
      if (!subset(positive.code.values, negative.code.values)) continue;
      out.push({ level: "error", code: "contradictory-inclusions", criteria: [positive.id, negative.id], message: `no patient can pass: "${positive.id}" requires a ${positive.code.system} code from {${positive.code.values.join(",")}} while "${negative.id}" forbids that entire set — for all inputs, not just a test corpus` });
    }
  }

  // inclusion-admitted interval per fact
  const admitted = new Map<string, { interval: Interval; sources: { id: string; interval: Interval }[] }>();
  for (const a of analyzed.filter((x) => x.kind === "inclusion")) {
    for (const [fact, iv] of a.intervals) {
      const prev = admitted.get(fact) ?? { interval: FULL, sources: [] };
      admitted.set(fact, { interval: intersect(prev.interval, iv), sources: [...prev.sources, { id: a.id, interval: iv }] });
    }
  }

  // two or more inclusions that no single value can satisfy: the whole rule set admits nobody.
  // A lone inclusion with an empty interval is already reported as unsatisfiable-criterion.
  for (const [fact, adm] of admitted) {
    if (!isEmpty(adm.interval) || adm.sources.length < 2) continue;
    let pair: { id: string; interval: Interval }[] = adm.sources;
    for (let i = 0; i < adm.sources.length; i += 1) {
      for (let j = i + 1; j < adm.sources.length; j += 1) {
        if (isEmpty(intersect(adm.sources[i]!.interval, adm.sources[j]!.interval))) pair = [adm.sources[i]!, adm.sources[j]!];
      }
    }
    out.push({
      level: "error",
      code: "contradictory-inclusions",
      criteria: pair.map((s) => s.id),
      message: `no patient can pass: the inclusion constraints on ${fact} from ${pair.map((s) => `"${s.id}"`).join(" and ")} intersect to the empty set — for all inputs, not just a test corpus`,
      evidence: `${fact}: inclusion constraints intersect to the empty set — ${pair.map((s) => `"${s.id}" admits ${fmtInterval(s.interval)}`).join(" ∩ ")}`,
    });
  }

  // ...and the same, one inclusion narrowing the fact to a single value while
  // another inclusion's `neq` rules that value out.
  for (const [fact, adm] of admitted) {
    if (isEmpty(adm.interval)) continue;
    const point = pointOf(adm.interval);
    if (point === undefined) continue;
    for (const a of analyzed) {
      if (a.kind !== "inclusion" || !(a.neqs.get(fact) ?? []).includes(point)) continue;
      const others = adm.sources.filter((s) => s.id !== a.id);
      if (others.length === 0) continue; // the same criterion; already reported above
      out.push({
        level: "error",
        code: "contradictory-inclusions",
        criteria: [...others.map((s) => s.id), a.id],
        message: `no patient can pass: the inclusion constraints on ${fact} from ${others.map((s) => `"${s.id}"`).join(" and ")} admit only ${point}, which "${a.id}" rules out with "neq ${point}" — for all inputs, not just a test corpus`,
        evidence: `${fact}: inclusions admit ${fmtInterval(adm.interval)} and "${a.id}" excludes ${point} → the empty set`,
      });
    }
  }

  // An exclusion is contradictory only when it eliminates the entire domain
  // admitted by all inclusions. Partial overlap is ordinary exclusion logic.
  for (const e of analyzed.filter((x) => x.kind === "exclusion" && x.fullyAnalyzed && x.intervals.size > 0)) {
    const eliminatesAll = [...e.intervals].every(([fact, exclIv]) => contains(exclIv, admitted.get(fact)?.interval ?? FULL));
    if (!eliminatesAll) continue;
    const sources = [...new Set([...e.intervals.keys()].flatMap((fact) => admitted.get(fact)?.sources.map((s) => s.id) ?? []))];
    out.push({
      level: "error",
      code: "unsatisfiable-ruleset",
      criteria: [...sources, e.id],
      message: `no patient can pass: exclusion "${e.id}" covers the entire numeric domain admitted by the inclusion criteria — for all inputs, not just a test corpus`,
      evidence: [...e.intervals].map(([fact, iv]) => `${fact}: admitted ${fmtInterval(admitted.get(fact)?.interval ?? FULL)} is contained by exclusion ${fmtInterval(iv)}`).join("; "),
    });
  }
  return out;
}

export function checkRuleSet(rs: RuleSet, fm: FactModel): Finding[] {
  return [...lintRuleSet(rs, fm), ...detectConflicts(rs)];
}
