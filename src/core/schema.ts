import { z } from "zod";
import { parse as parseYaml } from "yaml";

export type NumericOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
export type CodeRef = { system: string; values: string[] };
export type NumericLeaf = { fact: string; op: NumericOp; value: number; unit?: string };
export type SetLeaf = { fact: string; op: "in" | "notIn"; codes: CodeRef };
export type ExistsLeaf = { fact: string; op: "exists" };
export type WithinLeaf = { fact: string; op: "anyWithin"; codes: CodeRef; windowDays: number };
export type Leaf = NumericLeaf | SetLeaf | ExistsLeaf | WithinLeaf;
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } | Leaf;
export type Criterion = { id: string; ref?: string; kind: "inclusion" | "exclusion"; verbatim: string; when?: Condition; unmodeled?: boolean };
export type RuleSet = { ruleset: string; rulesetVersion: string; factModel: string; protocol?: string; status?: string; effective?: string; source?: { registry?: string; id?: string; url?: string }; criteria: Criterion[] };
export type FactDecl = { type: "number"; unit?: string } | { type: "code"; systems: string[] } | { type: "enum"; values: string[] } | { type: "boolean" };
export type FactModel = { name: string; facts: Record<string, FactDecl> };
export type CodeEntry = { code: string; system: string; daysAgo?: number };
export type FactValue = number | string | boolean | CodeEntry[];
export type PatientFacts = { patient: string; facts: Record<string, FactValue> };
export type Verdict = "pass" | "fail" | "unknown";
export type Overall = "eligible" | "ineligible" | "undetermined";
export type TestCase = { name: string; facts: Record<string, FactValue>; expect: Record<string, string> };
export type TestSuite = { cases: TestCase[] };

const codeRef = z.object({ system: z.string(), values: z.array(z.coerce.string()).min(1) });

const leaf = z.union([
  z.strictObject({ fact: z.string(), op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]), value: z.number(), unit: z.string().optional() }),
  z.strictObject({ fact: z.string(), op: z.enum(["in", "notIn"]), codes: codeRef }),
  z.strictObject({ fact: z.string(), op: z.literal("exists") }),
  z.strictObject({ fact: z.string(), op: z.literal("anyWithin"), codes: codeRef, windowDays: z.number().int().positive() }),
]);

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(condition).min(1) }),
    z.strictObject({ any: z.array(condition).min(1) }),
    z.strictObject({ not: condition }),
    leaf,
  ]),
);

const criterion = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    ref: z.string().optional(),
    kind: z.enum(["inclusion", "exclusion"]),
    verbatim: z.string(),
    when: condition.optional(),
    unmodeled: z.literal(true).optional(),
  })
  .refine((c) => (c.when !== undefined) !== (c.unmodeled === true), {
    message: "criterion needs exactly one of `when` or `unmodeled: true`",
  });

const ruleSet = z
  .strictObject({
    ruleset: z.string(),
    rulesetVersion: z.string(),
    factModel: z.string(),
    protocol: z.string().optional(),
    status: z.string().optional(),
    effective: z.coerce.string().optional(),
    source: z.object({ registry: z.string().optional(), id: z.string().optional(), url: z.string().optional() }).optional(),
    criteria: z.array(criterion).min(1),
  })
  .refine((r) => new Set(r.criteria.map((c) => c.id)).size === r.criteria.length, {
    message: "duplicate criterion ids",
  });

const factDecl = z.union([
  z.strictObject({ type: z.literal("number"), unit: z.string().optional() }),
  z.strictObject({ type: z.literal("code"), systems: z.array(z.string()).min(1) }),
  z.strictObject({ type: z.literal("enum"), values: z.array(z.string()).min(1) }),
  z.strictObject({ type: z.literal("boolean") }),
]);
const factModel = z.strictObject({ name: z.string(), facts: z.record(z.string(), factDecl) });

const codeEntry = z.strictObject({ code: z.coerce.string(), system: z.string(), daysAgo: z.number().int().nonnegative().optional() });
const factValue = z.union([z.number(), z.boolean(), z.array(codeEntry), z.string()]);
const patientFacts = z.strictObject({ patient: z.string(), facts: z.record(z.string(), factValue) });

const testSuite = z.strictObject({
  cases: z.array(z.strictObject({ name: z.string(), facts: z.record(z.string(), factValue), expect: z.record(z.string(), z.string()) })).min(1),
});

// zod v4 nests the per-branch errors of a failed union inside `errors` and only
// reports "Invalid input" at the union itself, so walk into them to keep the
// message specific (e.g. the offending `op`). Paths inside a branch are
// relative to the union's own path.
function describeIssues(issues: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []): string[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      return issue.errors.flatMap((branch) => describeIssues(branch, path));
    }
    return [`${path.join(".")}: ${issue.message}`];
  });
}

function parseWith<T>(schema: z.ZodType<T>, yamlText: string, what: string): T {
  const raw: unknown = parseYaml(yamlText);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = [...new Set(describeIssues(result.error.issues))].join("; ");
    throw new Error(`invalid ${what}: ${issues}`);
  }
  return result.data;
}

export const parseRuleSet = (t: string): RuleSet => parseWith(ruleSet, t, "ruleset");
export const parseFactModel = (t: string): FactModel => parseWith(factModel, t, "fact model");
export const parsePatient = (t: string): PatientFacts => parseWith(patientFacts, t, "patient");
export const parseTestSuite = (t: string): TestSuite => parseWith(testSuite, t, "test suite");
