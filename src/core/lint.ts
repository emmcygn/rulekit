import type { Condition, FactModel, Leaf, NumericLeaf, PatientFacts, RuleSet } from "./schema.js";

export type Finding = { level: "error" | "warning" | "info"; code: string; message: string; criteria: string[]; evidence?: string };

const NUMERIC_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte"]);
const CODE_OPS = new Set(["in", "notIn", "anyWithin"]);

// Spelling-only aliases accepted by the ingestion normalizer. These never
// change the numeric value (unlike analyte-scoped conversions such as
// fraction -> percent), so accepting either spelling here is safe.
const UNIT_ALIASES: Record<string, string> = {
  "mg/dl": "mg/dL", "MG/DL": "mg/dL", "Mg/Dl": "mg/dL", "milligrams per deciliter": "mg/dL", "mg / dL": "mg/dL",
  "mmol/l": "mmol/L", "MMOL/L": "mmol/L", "millimoles per liter": "mmol/L",
  "g/dl": "g/dL", "G/DL": "g/dL", "grams per deciliter": "g/dL",
  "pg/ml": "pg/mL", "PG/ML": "pg/mL", "picograms per milliliter": "pg/mL",
  "u/l": "U/L", "U/l": "U/L", "IU/L": "U/L",
  mmHg: "mm[Hg]", "mm Hg": "mm[Hg]", MMHG: "mm[Hg]",
  percent: "%", pct: "%", "%%": "%",
  KG: "kg", kgs: "kg", kilograms: "kg", CM: "cm", centimeters: "cm",
  "kg/m^2": "kg/m2", "kg/m²": "kg/m2",
  "mL/min/1.73m2": "mL/min/{1.73_m2}", "mL/min/1.73 m2": "mL/min/{1.73_m2}", "ml/min/1.73m^2": "mL/min/{1.73_m2}", "mL/min per 1.73 m2": "mL/min/{1.73_m2}",
  "x10E3/uL": "10*3/uL", "10^3/uL": "10*3/uL", "K/uL": "10*3/uL", "thousand per microliter": "10*3/uL",
};

function unitsEquivalent(a: string, b: string): boolean {
  return a === b || UNIT_ALIASES[a] === b || UNIT_ALIASES[b] === a || (UNIT_ALIASES[a] !== undefined && UNIT_ALIASES[a] === UNIT_ALIASES[b]);
}

const isNumericLeaf = (l: Leaf): l is NumericLeaf => NUMERIC_OPS.has(l.op) && "value" in l && typeof l.value === "number";

export function collectLeaves(cond: Condition): Leaf[] {
  if ("all" in cond) return cond.all.flatMap(collectLeaves);
  if ("any" in cond) return cond.any.flatMap(collectLeaves);
  if ("not" in cond) return collectLeaves(cond.not);
  return [cond];
}

export function lintRuleSet(rs: RuleSet, fm: FactModel): Finding[] {
  const out: Finding[] = [];
  if (rs.factModel !== fm.name) {
    out.push({ level: "error", code: "fact-model-mismatch", criteria: [], message: `rule set declares factModel "${rs.factModel}" but loaded model is "${fm.name}"` });
  }
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
      if (isNumericLeaf(leaf) && decl.type !== "number") {
        out.push({ level: "error", code: "type-mismatch", criteria: [c.id], message: `numeric op "${leaf.op}" on ${decl.type} fact "${leaf.fact}"` });
      }
      if ("value" in leaf && typeof leaf.value === "string") {
        if (decl.type !== "enum") {
          out.push({ level: "error", code: "type-mismatch", criteria: [c.id], message: `string equality on ${decl.type} fact "${leaf.fact}"` });
        } else if (!decl.values.includes(leaf.value)) {
          out.push({ level: "error", code: "unknown-enum-value", criteria: [c.id], message: `value ${JSON.stringify(leaf.value)} is not declared for enum fact "${leaf.fact}" (declared: ${decl.values.join(", ")})` });
        }
      }
      if ("value" in leaf && typeof leaf.value === "boolean" && decl.type !== "boolean") {
        out.push({ level: "error", code: "type-mismatch", criteria: [c.id], message: `boolean equality on ${decl.type} fact "${leaf.fact}"` });
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
      // No conversion exists, so evaluating an ambiguous or mismatched literal
      // would be a silently wrong calculation. Both findings are hard errors.
      if (isNumericLeaf(leaf) && decl.type === "number") {
        if (decl.unit === undefined && leaf.unit !== undefined) {
          out.push({ level: "error", code: "unit-unexpected", criteria: [c.id], message: `"${c.id}" gives unit ${leaf.unit} for unitless fact "${leaf.fact}". Remove the unit or declare one in the fact model.` });
        } else if (decl.unit !== undefined && leaf.unit === undefined) {
          out.push({ level: "error", code: "unit-undeclared", criteria: [c.id], message: `"${c.id}" compares "${leaf.fact}" against a bare ${leaf.value}; the fact model declares it in ${decl.unit}. Add "unit: ${decl.unit}" before evaluation.` });
        } else if (decl.unit !== undefined && leaf.unit !== undefined && leaf.unit !== decl.unit) {
          out.push({ level: "error", code: "unit-mismatch", criteria: [c.id], message: `"${c.id}" compares in ${leaf.unit}; the fact model declares "${leaf.fact}" in ${decl.unit}. No conversion exists, so evaluation is blocked.` });
        }
      }
      if (leaf.op === "exists" && (decl.type === "boolean" || decl.type === "enum")) {
        out.push({ level: "error", code: "exists-value-type", criteria: [c.id], message: `"exists" checks only presence of ${decl.type} fact "${leaf.fact}"; use eq/neq to test its value` });
      }
    }
  }
  return out;
}

/** Validate the patient-side half of the fact-model contract before evaluation. */
export function lintPatient(p: PatientFacts, fm: FactModel): Finding[] {
  const out: Finding[] = [];
  for (const [name, value] of Object.entries(p.facts)) {
    const decl = fm.facts[name];
    if (decl === undefined) continue; // ingestion may retain unused provenance/helper fields
    const issue = (message: string): void => {
      out.push({ level: "error", code: "invalid-patient-fact", criteria: [], message: `${p.patient}.${name}: ${message}` });
    };
    if (decl.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) issue(`expected finite number in ${decl.unit ?? "the declared canonical unit"}`);
    if (decl.type === "boolean" && typeof value !== "boolean") issue("expected boolean");
    if (decl.type === "enum" && (typeof value !== "string" || !decl.values.includes(value))) issue(`expected one of ${decl.values.join(", ")}`);
    if (decl.type === "code") {
      if (!Array.isArray(value)) issue(`expected code list using ${decl.systems.join(", ")}`);
      else for (const rawEntry of value as unknown[]) {
        if (typeof rawEntry !== "object" || rawEntry === null) {
          issue("expected each code entry to be an object");
          continue;
        }
        const entry = rawEntry as Record<string, unknown>;
        if (typeof entry.code !== "string" || entry.code.length === 0) issue("expected each code entry to have a non-empty string code");
        if (typeof entry.system !== "string" || !decl.systems.includes(entry.system)) issue(`code ${String(entry.code)} uses undeclared system "${String(entry.system)}" (declared: ${decl.systems.join(", ")})`);
        if (entry.daysAgo !== undefined && (typeof entry.daysAgo !== "number" || !Number.isInteger(entry.daysAgo) || entry.daysAgo < 0)) issue("expected daysAgo to be a non-negative integer");
      }
    }
  }
  for (const [name, decl] of Object.entries(fm.facts)) {
    if (decl.type !== "number") continue;
    const companionName = `${name}_unit`;
    const observed = p.facts[companionName];
    if (observed === undefined) continue;
    const issue = (message: string): void => {
      out.push({ level: "error", code: "invalid-patient-unit", criteria: [], message: `${p.patient}.${companionName}: ${message}` });
    };
    if (typeof observed !== "string" || observed.length === 0) {
      issue("expected a non-empty unit string");
    } else if (decl.unit === undefined) {
      issue(`fact "${name}" is declared unitless, so a companion unit is unexpected`);
    } else if (!unitsEquivalent(observed, decl.unit)) {
      issue(`unit "${observed}" does not match declared unit "${decl.unit}" or a spelling-only alias; conversion is required before evaluation`);
    }
  }
  return out;
}
