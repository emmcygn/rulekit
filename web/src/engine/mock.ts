/**
 * Hand-rolled, deterministic stand-in for the rulekit core engine.
 *
 * It implements the same `Engine` contract the real core will satisfy so the
 * workbench runs standalone. It is intentionally small: Kleene evaluation with
 * traces, an interval-arithmetic conflict pass, and a corpus behavioral diff.
 * At integration this file is deleted and `realEngine` takes its place.
 */
import {
  parseRuleSet,
  parseFactModel,
  type Condition,
  type Criterion,
  type FactModel,
  type FactValue,
  type Leaf,
  type PatientFacts,
  type RuleSet,
} from "../../../src/core/schema.js";
import type {
  CriterionResult,
  Engine,
  Evaluation,
  Finding,
  Flip,
  TraceNode,
  Tri,
} from "./api.js";

/* ------------------------------------------------------------------ Kleene */

const andTri = (xs: Tri[]): Tri =>
  xs.includes("false") ? "false" : xs.includes("unknown") ? "unknown" : "true";
const orTri = (xs: Tri[]): Tri =>
  xs.includes("true") ? "true" : xs.includes("unknown") ? "unknown" : "false";
const notTri = (x: Tri): Tri => (x === "true" ? "false" : x === "false" ? "true" : "unknown");

/* ---------------------------------------------------------------- parsing */

const ruleSetCache = new Map<string, RuleSet>();

/** Parse + memoize; the sensitivity slider re-evaluates the cohort per tick. */
export function ruleSetOf(yamlText: string): RuleSet {
  const hit = ruleSetCache.get(yamlText);
  if (hit) return hit;
  const parsed = parseRuleSet(yamlText);
  if (ruleSetCache.size > 32) ruleSetCache.clear();
  ruleSetCache.set(yamlText, parsed);
  return parsed;
}

/* ------------------------------------------------------------- evaluation */

export const OP_SYMBOL = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
} as const satisfies Record<string, string>;

type NumOp = keyof typeof OP_SYMBOL;
const isNumOp = (op: string): op is NumOp => op in OP_SYMBOL;
const symbolOf = (op: string): string => (isNumOp(op) ? OP_SYMBOL[op] : op);
const NEGATED = {
  eq: "neq",
  neq: "eq",
  gt: "lte",
  gte: "lt",
  lt: "gte",
  lte: "gt",
} as const satisfies Record<NumOp, NumOp>;

function isLeaf(c: Condition): c is Leaf {
  return "fact" in c;
}

function numeric(value: FactValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function codes(value: FactValue | undefined): { code: string; system: string; daysAgo?: number }[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function evalLeaf(leaf: Leaf, facts: Record<string, FactValue>): TraceNode {
  const observed = facts[leaf.fact];
  const missing = (why: string): TraceNode => ({
    kind: "leaf",
    result: "unknown",
    detail: `${leaf.fact} — ${why}`,
    observed,
  });

  if (leaf.op === "exists") {
    const present = observed !== undefined && observed !== null;
    return {
      kind: "leaf",
      result: present ? "true" : "false",
      detail: `${leaf.fact} ${present ? "recorded" : "not recorded"}`,
      observed,
    };
  }

  if (leaf.op === "in" || leaf.op === "notIn") {
    const entries = codes(observed);
    if (entries === undefined) return missing("not recorded");
    const wanted = new Set(leaf.codes.values);
    const hit = entries.find((e) => e.system === leaf.codes.system && wanted.has(e.code));
    const present = hit !== undefined;
    const result: Tri = leaf.op === "in" ? (present ? "true" : "false") : present ? "false" : "true";
    return {
      kind: "leaf",
      result,
      detail: present
        ? `${leaf.fact} includes ${hit.code}`
        : `${leaf.fact} has none of ${leaf.codes.values.join(", ")}`,
      observed,
    };
  }

  if (leaf.op === "anyWithin") {
    const entries = codes(observed);
    if (entries === undefined) return missing("not evaluable, no medication reconciliation");
    const wanted = new Set(leaf.codes.values);
    const hit = entries.find(
      (e) =>
        e.system === leaf.codes.system &&
        wanted.has(e.code) &&
        e.daysAgo !== undefined &&
        e.daysAgo <= leaf.windowDays,
    );
    return {
      kind: "leaf",
      result: hit ? "true" : "false",
      detail: hit
        ? `${hit.code} ${hit.daysAgo}d ago — inside ${leaf.windowDays}d window`
        : `no ${leaf.codes.values.join("/")} within ${leaf.windowDays}d`,
      observed,
    };
  }

  const n = numeric(observed);
  if (n === undefined) {
    return missing(
      observed === undefined
        ? "not recorded"
        : `not evaluable, value is ${JSON.stringify(observed)}`,
    );
  }
  const cmp: Record<typeof leaf.op, boolean> = {
    eq: n === leaf.value,
    neq: n !== leaf.value,
    gt: n > leaf.value,
    gte: n >= leaf.value,
    lt: n < leaf.value,
    lte: n <= leaf.value,
  };
  const result: Tri = cmp[leaf.op] ? "true" : "false";
  const shown = result === "true" ? OP_SYMBOL[leaf.op] : OP_SYMBOL[NEGATED[leaf.op]];
  return {
    kind: "leaf",
    result,
    detail: `${leaf.fact} = ${n} ${shown} ${leaf.value}`,
    observed: n,
  };
}

export function evalCondition(c: Condition, facts: Record<string, FactValue>): TraceNode {
  if (isLeaf(c)) return evalLeaf(c, facts);
  if ("all" in c) {
    const children = c.all.map((k) => evalCondition(k, facts));
    const result = andTri(children.map((k) => k.result));
    return { kind: "all", result, detail: `all of ${children.length}`, children };
  }
  if ("any" in c) {
    const children = c.any.map((k) => evalCondition(k, facts));
    const result = orTri(children.map((k) => k.result));
    return { kind: "any", result, detail: `any of ${children.length}`, children };
  }
  const child = evalCondition(c.not, facts);
  return { kind: "not", result: notTri(child.result), detail: "not", children: [child] };
}

export function evalCriterion(c: Criterion, facts: Record<string, FactValue>): CriterionResult {
  if (c.unmodeled || c.when === undefined) {
    return {
      id: c.id,
      ref: c.ref,
      kind: c.kind,
      verdict: "unknown",
      unmodeled: true,
      trace: {
        kind: "leaf",
        result: "unknown",
        detail: "not computable from structured data — chart review required",
      },
    };
  }
  const trace = evalCondition(c.when, facts);
  // Inclusion: the condition must hold. Exclusion: the condition firing removes
  // the patient. Either way `unknown` stays `unknown` — never a silent verdict.
  const verdict: CriterionResult["verdict"] =
    trace.result === "unknown"
      ? "unknown"
      : c.kind === "inclusion"
        ? trace.result === "true"
          ? "pass"
          : "fail"
        : trace.result === "true"
          ? "fail"
          : "pass";
  return { id: c.id, ref: c.ref, kind: c.kind, verdict, unmodeled: false, trace };
}

export function overallOf(results: CriterionResult[]): Evaluation["overall"] {
  if (results.some((r) => r.verdict === "fail")) return "ineligible";
  if (results.some((r) => r.verdict === "unknown")) return "undetermined";
  return "eligible";
}

/* ------------------------------------------------------ conflict analysis */

type Interval = { lo: number; hi: number; loOpen: boolean; hiOpen: boolean };

function intervalOf(op: string, value: number): Interval | undefined {
  switch (op) {
    case "eq":
      return { lo: value, hi: value, loOpen: false, hiOpen: false };
    case "gt":
      return { lo: value, hi: Infinity, loOpen: true, hiOpen: true };
    case "gte":
      return { lo: value, hi: Infinity, loOpen: false, hiOpen: true };
    case "lt":
      return { lo: -Infinity, hi: value, loOpen: true, hiOpen: true };
    case "lte":
      return { lo: -Infinity, hi: value, loOpen: true, hiOpen: false };
    default:
      return undefined;
  }
}

function intersect(a: Interval, b: Interval): Interval {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  return {
    lo,
    hi,
    loOpen: a.lo === b.lo ? a.loOpen || b.loOpen : lo === a.lo ? a.loOpen : b.loOpen,
    hiOpen: a.hi === b.hi ? a.hiOpen || b.hiOpen : hi === a.hi ? a.hiOpen : b.hiOpen,
  };
}

function isEmpty(i: Interval): boolean {
  if (i.lo > i.hi) return true;
  if (i.lo === i.hi) return i.loOpen || i.hiOpen;
  return false;
}

export function fmtInterval(i: Interval): string {
  const lo = i.lo === -Infinity ? "−∞" : String(i.lo);
  const hi = i.hi === Infinity ? "∞" : String(i.hi);
  const open = i.loOpen || i.lo === -Infinity ? "(" : "[";
  const close = i.hiOpen || i.hi === Infinity ? ")" : "]";
  return `${open}${lo}, ${hi}${close}`;
}

/** Every numeric leaf in a condition tree, flattened (no nesting semantics). */
function numericLeaves(c: Condition): { fact: string; op: string; value: number; unit?: string }[] {
  if (isLeaf(c)) {
    return "value" in c && typeof c.value === "number"
      ? [{ fact: c.fact, op: c.op, value: c.value, unit: c.unit }]
      : [];
  }
  if ("all" in c) return c.all.flatMap(numericLeaves);
  if ("any" in c) return c.any.flatMap(numericLeaves);
  return numericLeaves(c.not);
}

function allLeaves(c: Condition): Leaf[] {
  if (isLeaf(c)) return [c];
  if ("all" in c) return c.all.flatMap(allLeaves);
  if ("any" in c) return c.any.flatMap(allLeaves);
  return allLeaves(c.not);
}

function checkParsed(rs: RuleSet, fm: FactModel | undefined): Finding[] {
  const out: Finding[] = [];

  // 1. fact-model lint: unknown facts, unit mismatch.
  if (fm) {
    for (const c of rs.criteria) {
      if (!c.when) continue;
      for (const leaf of allLeaves(c.when)) {
        const decl = fm.facts[leaf.fact];
        if (!decl) {
          out.push({
            level: "error",
            code: "unknown-fact",
            message: `${c.id} references fact \`${leaf.fact}\`, which the fact model ${fm.name} does not declare.`,
            criteria: [c.id],
            evidence: `fact model declares: ${Object.keys(fm.facts).join(", ")}`,
          });
          continue;
        }
        if ("unit" in leaf && leaf.unit && decl.type === "number" && decl.unit && leaf.unit !== decl.unit) {
          out.push({
            level: "warning",
            code: "unit-mismatch",
            message: `${c.id} compares in \`${leaf.unit}\`; the fact model declares \`${leaf.fact}\` in \`${decl.unit}\`. Not interchangeable — the comparison is silently wrong for some patients.`,
            criteria: [c.id],
            evidence: `${leaf.fact}: rule unit ${leaf.unit} ≠ declared unit ${decl.unit}`,
          });
        }
      }
    }
  }

  // 2. self-contradictory criterion: its own `all` clauses over one fact cannot
  //    all hold at once.
  for (const c of rs.criteria) {
    if (!c.when || !("all" in c.when)) continue;
    const byFact = new Map<string, Interval>();
    for (const leaf of numericLeaves(c.when)) {
      const iv = intervalOf(leaf.op, leaf.value);
      if (!iv) continue;
      const prev = byFact.get(leaf.fact);
      byFact.set(leaf.fact, prev ? intersect(prev, iv) : iv);
    }
    for (const [fact, iv] of byFact) {
      if (isEmpty(iv)) {
        out.push({
          level: "error",
          code: "unsatisfiable",
          message: `${c.id} can never fire: its own clauses over \`${fact}\` have an empty intersection.`,
          criteria: [c.id],
          evidence: `${fact}: intersection ${fmtInterval(iv)} is empty`,
        });
      }
    }
  }

  // 3. inclusion admits a band that an exclusion then catches — for all inputs,
  //    not just this cohort.
  const inclusions = rs.criteria.filter((c) => c.kind === "inclusion" && c.when);
  const exclusions = rs.criteria.filter((c) => c.kind === "exclusion" && c.when);
  for (const inc of inclusions) {
    for (const incLeaf of numericLeaves(inc.when as Condition)) {
      const incIv = intervalOf(incLeaf.op, incLeaf.value);
      if (!incIv) continue;
      for (const exc of exclusions) {
        for (const excLeaf of numericLeaves(exc.when as Condition)) {
          if (excLeaf.fact !== incLeaf.fact) continue;
          const excIv = intervalOf(excLeaf.op, excLeaf.value);
          if (!excIv) continue;
          const band = intersect(incIv, excIv);
          if (isEmpty(band)) continue;
          out.push({
            level: "error",
            code: "contradictory-band",
            message: `Inclusion \`${inc.id}\` admits ${incLeaf.fact} ${symbolOf(incLeaf.op)} ${incLeaf.value}, but exclusion \`${exc.id}\` fires on ${excLeaf.fact} ${symbolOf(excLeaf.op)} ${excLeaf.value}. Every patient in ${fmtInterval(band)} passes the inclusion and is then excluded.`,
            criteria: [inc.id, exc.id],
            evidence: `${incLeaf.fact}: inclusion admits ${fmtInterval(incIv)} ∩ exclusion fires ${fmtInterval(excIv)} → contradictory band ${fmtInterval(band)}`,
          });
        }
      }
    }
  }

  // 4. honesty ledger: criteria the condition language cannot express.
  for (const c of rs.criteria) {
    if (!c.unmodeled) continue;
    out.push({
      level: "info",
      code: "unmodeled",
      message: `"${c.verbatim}" [${c.ref ?? c.id}] is marked \`unmodeled: true\` — it lives in clinical notes, not structured data. Every patient reaching it evaluates *pending chart review*, never silently eligible.`,
      criteria: [c.id],
    });
  }

  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/* ---------------------------------------------------------------- engine */

export const mockEngine: Engine = {
  evalPatient(rulesetYaml: string, patient: PatientFacts): Evaluation {
    const rs = ruleSetOf(rulesetYaml);
    const results = rs.criteria.map((c) => evalCriterion(c, patient.facts));
    return { patient: patient.patient, results, overall: overallOf(results) };
  },

  check(rulesetYaml: string, factModelYaml: string): Finding[] {
    let rs: RuleSet;
    try {
      rs = ruleSetOf(rulesetYaml);
    } catch (err) {
      return [
        {
          level: "error",
          code: "schema",
          message: err instanceof Error ? err.message : String(err),
          criteria: [],
        },
      ];
    }
    let fm: FactModel | undefined;
    try {
      fm = parseFactModel(factModelYaml);
    } catch {
      fm = undefined;
    }
    return checkParsed(rs, fm);
  },

  behavioralDiff(aYaml: string, bYaml: string, corpus: PatientFacts[]): Flip[] {
    const flips: Flip[] = [];
    for (const p of corpus) {
      const a = this.evalPatient(aYaml, p);
      const b = this.evalPatient(bYaml, p);
      if (a.overall === b.overall) continue;
      const byId = new Map(a.results.map((r) => [r.id, r.verdict]));
      const responsible = b.results
        .filter((r) => {
          const before = byId.get(r.id);
          if (before === r.verdict) return false;
          if (b.overall === "ineligible") return r.verdict === "fail";
          if (a.overall === "ineligible") return before === "fail";
          return true;
        })
        .map((r) => r.id);
      // A criterion present only in the older version can also be responsible.
      const inB = new Set(b.results.map((r) => r.id));
      for (const r of a.results) {
        if (!inB.has(r.id) && r.verdict === "fail") responsible.push(r.id);
      }
      flips.push({ patient: p.patient, from: a.overall, to: b.overall, responsible });
    }
    return flips;
  },
};
