import type { Condition, FactModel, Leaf, NumericLeaf, RuleSet } from "./schema.js";

export type Finding = { level: "error" | "warning" | "info"; code: string; message: string; criteria: string[]; evidence?: string };

const NUMERIC_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte"]);
const CODE_OPS = new Set(["in", "notIn", "anyWithin"]);

const isNumericLeaf = (l: Leaf): l is NumericLeaf => NUMERIC_OPS.has(l.op);

export function collectLeaves(cond: Condition): Leaf[] {
  if ("all" in cond) return cond.all.flatMap(collectLeaves);
  if ("any" in cond) return cond.any.flatMap(collectLeaves);
  if ("not" in cond) return collectLeaves(cond.not);
  return [cond];
}

export function lintRuleSet(rs: RuleSet, fm: FactModel): Finding[] {
  const out: Finding[] = [];
  for (const c of rs.criteria) {
    if (c.unmodeled === true || c.when === undefined) {
      out.push({ level: "info", code: "unmodeled-criterion", criteria: [c.id], message: `"${c.verbatim}" is carried as verbatim text (unmodeled: true); affected patients evaluate unknown` });
      continue;
    }
    for (const leaf of collectLeaves(c.when)) {
      const decl = fm.facts[leaf.fact];
      if (decl === undefined) {
        out.push({ level: "error", code: "unknown-fact", criteria: [c.id], message: `fact "${leaf.fact}" is not declared in ${fm.name}` });
        continue;
      }
      if (NUMERIC_OPS.has(leaf.op) && decl.type !== "number") {
        out.push({ level: "error", code: "type-mismatch", criteria: [c.id], message: `numeric op "${leaf.op}" on ${decl.type} fact "${leaf.fact}"` });
      }
      if (CODE_OPS.has(leaf.op)) {
        if (decl.type !== "code") {
          out.push({ level: "error", code: "type-mismatch", criteria: [c.id], message: `code op "${leaf.op}" on ${decl.type} fact "${leaf.fact}"` });
        } else if ("codes" in leaf && !decl.systems.includes(leaf.codes.system)) {
          out.push({ level: "error", code: "unknown-code-system", criteria: [c.id], message: `code system "${leaf.codes.system}" not declared for fact "${leaf.fact}" (declared: ${decl.systems.join(", ")})` });
        }
      }
      // Units. The evaluator compares raw numbers and converts nothing, so the
      // declared unit is the only place a threshold's scale is written down.
      // Both halves are warnings so that neither blocks CI, but neither is
      // silent — the previous rule warned only on a *declared* mismatch, which
      // rewarded omitting the unit entirely.
      if (isNumericLeaf(leaf) && decl.type === "number" && decl.unit !== undefined) {
        if (leaf.unit === undefined) {
          out.push({ level: "warning", code: "unit-undeclared", criteria: [c.id], message: `"${c.id}" compares "${leaf.fact}" against a bare ${leaf.value}; the fact model declares it in ${decl.unit}. Values are compared as-is, so a threshold transcribed from a protocol written in another unit (mg/dL for mmol/L, mL/min for L/min, ng/mL for pg/mL) is wrong by a factor and nothing else here will catch it. Add "unit: ${decl.unit}".` });
        } else if (leaf.unit !== decl.unit) {
          out.push({ level: "warning", code: "unit-mismatch", criteria: [c.id], message: `"${c.id}" compares in ${leaf.unit}; the fact model declares "${leaf.fact}" in ${decl.unit}. Values are compared as-is — declare the same unit or add a conversion.` });
        }
      }
    }
  }
  return out;
}
