import { z } from "zod";
import { parse as parseYaml } from "yaml";

export type NumericOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
export type CodeRef = { system: string; values: string[] };
export type NumericLeaf = { fact: string; op: NumericOp; value: number; unit?: string };
export type ScalarLeaf = { fact: string; op: "eq" | "neq"; value: string | boolean };
export type SetLeaf = { fact: string; op: "in" | "notIn"; codes: CodeRef };
export type ExistsLeaf = { fact: string; op: "exists" };
export type WithinLeaf = { fact: string; op: "anyWithin"; codes: CodeRef; windowDays: number };
export type Leaf = NumericLeaf | ScalarLeaf | SetLeaf | ExistsLeaf | WithinLeaf;
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

export const PARSE_LIMITS = {
  documentChars: 1_000_000,
  nestingDepth: 64,
  structuralNodes: 50_000,
  criteria: 1_000,
  conditionChildren: 1_000,
  codeValues: 1_000,
  facts: 10_000,
  codeEntries: 10_000,
  testCases: 10_000,
} as const;

const nonEmpty = z.string().min(1);
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}, { message: "must be a real ISO-8601 calendar date" });
const factName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const codeRef = z.strictObject({ system: nonEmpty, values: z.array(nonEmpty).min(1).max(PARSE_LIMITS.codeValues) });

const leaf = z.union([
  z.strictObject({ fact: factName, op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]), value: z.number(), unit: nonEmpty.optional() }),
  z.strictObject({ fact: factName, op: z.enum(["eq", "neq"]), value: z.union([nonEmpty, z.boolean()]) }),
  z.strictObject({ fact: factName, op: z.enum(["in", "notIn"]), codes: codeRef }),
  z.strictObject({ fact: factName, op: z.literal("exists") }),
  z.strictObject({ fact: factName, op: z.literal("anyWithin"), codes: codeRef, windowDays: z.number().int().nonnegative() }),
]);

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(condition).min(1).max(PARSE_LIMITS.conditionChildren) }),
    z.strictObject({ any: z.array(condition).min(1).max(PARSE_LIMITS.conditionChildren) }),
    z.strictObject({ not: condition }),
    leaf,
  ]),
);

const criterion = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).refine((id) => id !== "overall", { message: 'criterion id "overall" is reserved for the aggregate test outcome' }),
    ref: nonEmpty.optional(),
    kind: z.enum(["inclusion", "exclusion"]),
    verbatim: nonEmpty,
    when: condition.optional(),
    unmodeled: z.literal(true).optional(),
  })
  .refine((c) => (c.when !== undefined) !== (c.unmodeled === true), {
    message: "criterion needs exactly one of `when` or `unmodeled: true`",
  });

const source = z.strictObject({ registry: nonEmpty.optional(), id: nonEmpty.optional(), url: nonEmpty.optional() })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "source must contain registry, id, or url",
  });

const ruleSet = z
  .strictObject({
    ruleset: nonEmpty,
    rulesetVersion: z.string().regex(semver),
    factModel: nonEmpty,
    protocol: nonEmpty.optional(),
    status: nonEmpty.optional(),
    effective: isoDate.optional(),
    source: source.optional(),
    criteria: z.array(criterion).min(1).max(PARSE_LIMITS.criteria),
  })
  .refine((r) => new Set(r.criteria.map((c) => c.id)).size === r.criteria.length, {
    message: "duplicate criterion ids",
  });

const factDecl = z.union([
  z.strictObject({ type: z.literal("number"), unit: nonEmpty.optional() }),
  z.strictObject({ type: z.literal("code"), systems: z.array(nonEmpty).min(1) }),
  z.strictObject({ type: z.literal("enum"), values: z.array(nonEmpty).min(1) }),
  z.strictObject({ type: z.literal("boolean") }),
]);
const limitedFacts = <T extends z.ZodType>(value: T) => z.record(factName, value).refine(
  (facts) => Object.keys(facts).length <= PARSE_LIMITS.facts,
  { message: `cannot contain more than ${PARSE_LIMITS.facts} facts` },
);
const factModel = z.strictObject({ name: nonEmpty, facts: z.record(factName, factDecl) });

const codeEntry = z.strictObject({ code: nonEmpty, system: nonEmpty, daysAgo: z.number().int().nonnegative().optional() });
const factValue = z.union([z.number(), z.boolean(), z.array(codeEntry).max(PARSE_LIMITS.codeEntries), z.string()]);
const patientFacts = z.strictObject({ patient: nonEmpty, facts: limitedFacts(factValue) });

const expectations = z.record(z.string().min(1), z.enum(["pass", "fail", "unknown", "eligible", "ineligible", "undetermined"]))
  .superRefine((value, ctx) => {
    if (!(["eligible", "ineligible", "undetermined"] as string[]).includes(value.overall ?? "")) {
      ctx.addIssue({ code: "custom", path: ["overall"], message: "every test case must assert `overall` as eligible, ineligible, or undetermined" });
    }
    for (const [key, expected] of Object.entries(value)) {
      if (key !== "overall" && !(["pass", "fail", "unknown"] as string[]).includes(expected)) {
        ctx.addIssue({ code: "custom", path: [key], message: "criterion expectations must be pass, fail, or unknown" });
      }
    }
  });

const testSuite = z.strictObject({
  cases: z.array(z.strictObject({
    name: nonEmpty,
    facts: limitedFacts(factValue),
    expect: expectations,
  })).min(1).max(PARSE_LIMITS.testCases),
}).refine((suite) => new Set(suite.cases.map((c) => c.name)).size === suite.cases.length, {
  message: "duplicate test case names",
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
  if (yamlText.length > PARSE_LIMITS.documentChars) {
    throw new Error(`invalid ${what}: document exceeds ${PARSE_LIMITS.documentChars} characters`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    throw new Error(`invalid ${what}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const seen = new WeakSet<object>();
  const stack: { value: unknown; depth: number }[] = [{ value: raw, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > PARSE_LIMITS.nestingDepth) {
      throw new Error(`invalid ${what}: nesting exceeds ${PARSE_LIMITS.nestingDepth} levels`);
    }
    if (typeof current.value !== "object" || current.value === null || seen.has(current.value)) continue;
    seen.add(current.value);
    nodes += 1;
    if (nodes > PARSE_LIMITS.structuralNodes) {
      throw new Error(`invalid ${what}: structure exceeds ${PARSE_LIMITS.structuralNodes} container nodes`);
    }
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value as Record<string, unknown>);
    for (const value of children) stack.push({ value, depth: current.depth + 1 });
  }
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
