import type { Condition, FactModel, Leaf, NumericLeaf, RuleSet } from "./schema.js";
import { FULL, fromLeaf, intersect, isEmpty, fmtInterval, type Interval } from "./interval.js";
import { lintRuleSet, type Finding } from "./lint.js";

const INTERVAL_OPS = new Set(["eq", "gt", "gte", "lt", "lte"]);

function isNumericIntervalLeaf(l: Leaf): l is NumericLeaf {
  return INTERVAL_OPS.has(l.op);
}

/** An interval that admits exactly one value, e.g. `[40, 40]` from `eq 40`. */
function pointOf(i: Interval): number | undefined {
  return i.lo === i.hi && !i.loOpen && !i.hiOpen && Number.isFinite(i.lo) ? i.lo : undefined;
}

/** Leaves reachable through `all` chains only; null if condition contains any/not. */
function allChainLeaves(cond: Condition): Leaf[] | null {
  if ("any" in cond || "not" in cond) return null;
  if ("all" in cond) {
    const parts = cond.all.map(allChainLeaves);
    if (parts.some((p) => p === null)) return null;
    return parts.flatMap((p) => p as Leaf[]);
  }
  return [cond];
}

type Analysis = {
  /** Per-fact interval from the criterion's `eq/gt/gte/lt/lte` leaves. */
  intervals: Map<string, Interval>;
  /** Per-fact values the criterion's `neq` leaves rule out. */
  neqs: Map<string, number[]>;
  /**
   * True when *every* leaf in the all-chain is an interval leaf on one single
   * fact. Only then does "this fact is in this interval" imply the criterion
   * fires; a second fact or a code/exists/anyWithin leaf is another conjunct
   * that has to hold too, and interval arithmetic says nothing about it.
   */
  singleFactComplete: boolean;
};

/** Per-fact intervals for one criterion, or null when not analyzable. */
function criterionIntervals(cond: Condition): Analysis | null {
  const leaves = allChainLeaves(cond);
  if (leaves === null) return null;
  const intervals = new Map<string, Interval>();
  const neqs = new Map<string, number[]>();
  let nonInterval = 0;
  for (const leaf of leaves) {
    if (isNumericIntervalLeaf(leaf)) {
      const prev = intervals.get(leaf.fact) ?? FULL;
      intervals.set(leaf.fact, intersect(prev, fromLeaf(leaf.op as "eq" | "gt" | "gte" | "lt" | "lte", leaf.value)));
      continue;
    }
    nonInterval += 1;
    // `neq v` carries no interval of its own (it punches a hole, which is not an
    // interval), but it does decide the one case interval arithmetic can see: an
    // interval already narrowed to the single point `v`.
    if (leaf.op === "neq") neqs.set(leaf.fact, [...(neqs.get(leaf.fact) ?? []), leaf.value]);
  }
  return { intervals, neqs, singleFactComplete: intervals.size === 1 && nonInterval === 0 };
}

export function detectConflicts(rs: RuleSet): Finding[] {
  const out: Finding[] = [];
  const analyzed: ({ id: string; kind: "inclusion" | "exclusion" } & Analysis)[] = [];

  for (const c of rs.criteria) {
    if (c.when === undefined) continue;
    const a = criterionIntervals(c.when);
    if (a === null) continue;
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
    if (a.intervals.size > 0 || a.neqs.size > 0) analyzed.push({ id: c.id, kind: c.kind, ...a });
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
    out.push({
      level: "error",
      code: "contradictory-inclusions",
      criteria: adm.sources.map((s) => s.id),
      message: `no patient can pass: the inclusion constraints on ${fact} from ${adm.sources.map((s) => `"${s.id}"`).join(" and ")} intersect to the empty set — for all inputs, not just a test corpus`,
      evidence: `${fact}: inclusion constraints intersect to the empty set — ${adm.sources.map((s) => `"${s.id}" admits ${fmtInterval(s.interval)}`).join(" ∩ ")}`,
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

  // A band claim says "every patient in this interval passes inclusion and is
  // then excluded". That is only true when the exclusion fires on this fact
  // alone: a multi-fact `all` needs its other conjuncts to hold as well, and
  // interval arithmetic cannot show they ever do. Those exclusions are skipped
  // rather than downgraded — see docs for the "may exclude" follow-up.
  for (const e of analyzed.filter((x) => x.kind === "exclusion" && x.singleFactComplete)) {
    for (const [fact, exclIv] of e.intervals) {
      const adm = admitted.get(fact);
      if (adm === undefined) continue;
      const band = intersect(adm.interval, exclIv);
      if (!isEmpty(band)) {
        out.push({
          level: "error",
          code: "contradictory-band",
          criteria: [...adm.sources.map((s) => s.id), e.id],
          message: `every patient with ${fact} in ${fmtInterval(band)} passes inclusion and is then excluded by "${e.id}" — for all inputs, not just a test corpus`,
          evidence: `${fact}: inclusion admits ${fmtInterval(adm.interval)} ∩ exclusion fires ${fmtInterval(exclIv)} → contradictory band ${fmtInterval(band)}`,
        });
      }
    }
  }
  return out;
}

export function checkRuleSet(rs: RuleSet, fm: FactModel): Finding[] {
  return [...lintRuleSet(rs, fm), ...detectConflicts(rs)];
}
