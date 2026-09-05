/**
 * `schema/*.schema.json` is the published, engine-independent definition of the
 * rule format (design spec §15, "format first"). It is hand-written rather than
 * emitted from the zod schemas in src/core, so this suite is what keeps the two
 * honest:
 *
 *   1. every YAML artifact this repo ships validates against its schema;
 *   2. for a battery of malformed documents, the schema and the reference
 *      parser agree — both reject;
 *   3. governance constraints such as semantic versions and calendar dates
 *      are rejected by both implementations.
 *
 * `validator.ts` is the small draft-2020-12 subset validator these use; the
 * negative cases below are also what stop it degenerating into a no-op.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { validate } from "./validator.js";
import { parseRuleSet, parseFactModel, parsePatient } from "../../src/core/schema.js";
import { parseFactsFile } from "../../src/extract/schema.js";

const repo = resolve(__dirname, "../..");
const load = (p: string): unknown => parseYaml(readFileSync(resolve(repo, p), "utf8"));
const schema = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(repo, "schema", name), "utf8")) as Record<string, unknown>;

const RULESET = schema("ruleset.schema.json");
const FACT_MODEL = schema("fact-model.schema.json");
const PATIENT_FACTS = schema("patient-facts.schema.json");
const FACTS_FILE = schema("facts-file.schema.json");

const yamlIn = (dir: string): string[] =>
  readdirSync(resolve(repo, dir))
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => `${dir}/${f}`);

const RULESETS = [
  "rules/trials/demo-hf-001/ruleset.yaml",
  "rules/trials/demo-hf-001/ruleset@1.0.0.yaml",
  "rules/trials/commander-hf/ruleset.yaml",
];

describe("shipped artifacts validate against the published schema", () => {
  it.each(RULESETS)("%s", (path) => {
    expect(validate(RULESET, load(path))).toEqual([]);
  });

  it("packs/trials/fact-model.yaml", () => {
    expect(validate(FACT_MODEL, load("packs/trials/fact-model.yaml"))).toEqual([]);
  });

  it.each(yamlIn("fixtures/patients"))("%s", (path) => {
    expect(validate(PATIENT_FACTS, load(path))).toEqual([]);
  });

  it("all 100 corpus/patients files", () => {
    const bad = yamlIn("corpus/patients")
      .map((p) => [p, validate(PATIENT_FACTS, load(p))] as const)
      .filter(([, errs]) => errs.length > 0);
    expect(bad).toEqual([]);
  });

  it.each(yamlIn("corpus/facts"))("%s", (path) => {
    expect(validate(FACTS_FILE, load(path))).toEqual([]);
  });

  it("tests/fixtures/facts-good/SYN-042.yaml", () => {
    expect(validate(FACTS_FILE, load("tests/fixtures/facts-good/SYN-042.yaml"))).toEqual([]);
  });
});

/**
 * Each entry must be rejected by BOTH the schema and the reference parser. A
 * case that only one side catches belongs in the divergences block below.
 */
const BAD_RULESETS: [name: string, yaml: string][] = [
  ["missing rulesetVersion", `ruleset: x\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
  ["empty criteria list", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: []`],
  ["criterion with neither when nor unmodeled", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v}]`],
  ["criterion with both when and unmodeled", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, unmodeled: true, when: {fact: age, op: gte, value: 18}}]`],
  ["unmodeled: false", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, unmodeled: false}]`],
  ["uppercase criterion id", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: Age, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
  ["reserved overall criterion id", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: overall, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
  ["unknown kind", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: maybe, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
  ["unknown leaf op", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: between, value: 18}}]`],
  ["stray key on a leaf", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18, windowDays: 30}}]`],
  ["numeric op with a string value", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: "18"}}]`],
  ["empty numeric unit", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18, unit: ""}}]`],
  ["empty scalar string", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: sex, op: eq, value: ""}}]`],
  ["empty all", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {all: []}}]`],
  ["empty code value set", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: exclusion, verbatim: v, when: {fact: medications, op: in, codes: {system: rxnorm, values: []}}}]`],
  ["exists leaf carrying a value", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: lvef, op: exists, value: 3}}]`],
  ["unknown top-level key", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\nowner: me\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
];

describe("schema and reference parser agree on malformed rule sets", () => {
  it.each(BAD_RULESETS)("rejects: %s", (_name, yaml) => {
    expect(validate(RULESET, parseYaml(yaml)).length).toBeGreaterThan(0);
    expect(() => parseRuleSet(yaml)).toThrow();
  });
});

describe("schema and reference parser enforce matching collection limits", () => {
  it("rejects oversized criteria and inline code sets", () => {
    const criteria = Array.from({ length: 1001 }, (_, i) => ({ id: `c${i}`, kind: "inclusion", verbatim: "v", when: { fact: "age", op: "gte", value: 18 } }));
    const tooManyCriteria = { ruleset: "x", rulesetVersion: "1.0.0", factModel: "patient-facts/v1", criteria };
    expect(validate(RULESET, tooManyCriteria).length).toBeGreaterThan(0);
    expect(() => parseRuleSet(JSON.stringify(tooManyCriteria))).toThrow();

    const values = Array.from({ length: 1001 }, (_, i) => `v${i}`);
    const tooManyCodes = { ruleset: "x", rulesetVersion: "1.0.0", factModel: "patient-facts/v1", criteria: [{ id: "a", kind: "inclusion", verbatim: "v", when: { fact: "conditions", op: "in", codes: { system: "snomed", values } } }] };
    expect(validate(RULESET, tooManyCodes).length).toBeGreaterThan(0);
    expect(() => parseRuleSet(JSON.stringify(tooManyCodes))).toThrow();
  });

  it("rejects oversized patient fact bags and code lists", () => {
    const facts = Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`f${i}`, i]));
    const tooManyFacts = { patient: "P", facts };
    expect(validate(PATIENT_FACTS, tooManyFacts).length).toBeGreaterThan(0);
    expect(() => parsePatient(JSON.stringify(tooManyFacts))).toThrow();

    const conditions = Array.from({ length: 10001 }, (_, i) => ({ code: String(i), system: "snomed" }));
    const tooManyCodes = { patient: "P", facts: { conditions } };
    expect(validate(PATIENT_FACTS, tooManyCodes).length).toBeGreaterThan(0);
    expect(() => parsePatient(JSON.stringify(tooManyCodes))).toThrow();
  });
});

const BAD_FACT_MODELS: [name: string, yaml: string][] = [
  ["unknown fact type", `name: m\nfacts: {age: {type: date}}`],
  ["code fact with no systems", `name: m\nfacts: {conditions: {type: code}}`],
  ["enum fact with no values", `name: m\nfacts: {nyha_class: {type: enum}}`],
  ["unit on a boolean fact", `name: m\nfacts: {on_arni: {type: boolean, unit: years}}`],
  ["missing name", `facts: {age: {type: number}}`],
];

describe("schema and reference parser agree on malformed fact models", () => {
  it.each(BAD_FACT_MODELS)("rejects: %s", (_name, yaml) => {
    expect(validate(FACT_MODEL, parseYaml(yaml)).length).toBeGreaterThan(0);
    expect(() => parseFactModel(yaml)).toThrow();
  });
});

const BAD_PATIENTS: [name: string, yaml: string][] = [
  ["no patient id", `facts: {age: 64}`],
  ["facts is a list", `patient: SYN-1\nfacts: [{age: 64}]`],
  ["code entry missing a system", `patient: SYN-1\nfacts: {medications: [{code: warfarin}]}`],
  ["negative daysAgo", `patient: SYN-1\nfacts: {medications: [{code: warfarin, system: rxnorm, daysAgo: -3}]}`],
  ["stray key on a code entry", `patient: SYN-1\nfacts: {medications: [{code: warfarin, system: rxnorm, dose: 5}]}`],
];

describe("schema and reference parser agree on malformed patient facts", () => {
  it.each(BAD_PATIENTS)("rejects: %s", (_name, yaml) => {
    expect(validate(PATIENT_FACTS, parseYaml(yaml)).length).toBeGreaterThan(0);
    expect(() => parsePatient(yaml)).toThrow();
  });
});

const BAD_FACTS_FILES: [name: string, yaml: string][] = [
  ["llm fact with no source", `patient: SYN-1\nfacts: [{fact: lvef, value: 32, status: proposed, confidence: 0.9, extractedBy: llm/claude-opus-5}]`],
  ["llm fact with no confidence", `patient: SYN-1\nfacts: [{fact: lvef, value: 32, status: proposed, extractedBy: llm/claude-opus-5, source: {doc: d, quote: q}}]`],
  ["pipeline fact carrying a confidence", `patient: SYN-1\nfacts: [{fact: age, value: 64, status: confirmed, confidence: 0.9, extractedBy: pipeline}]`],
  ["pipeline fact marked proposed", `patient: SYN-1\nfacts: [{fact: age, value: 64, status: proposed, extractedBy: pipeline}]`],
  ["confirmed fact with no reviewer", `patient: SYN-1\nfacts: [{fact: lvef, value: 32, status: confirmed, confidence: 0.9, extractedBy: llm/claude-opus-5, source: {doc: d, quote: q}, reviewedBy: null}]`],
  ["proposed fact claiming a reviewer", `patient: SYN-1\nfacts: [{fact: lvef, value: 32, status: proposed, confidence: 0.9, extractedBy: llm/claude-opus-5, source: {doc: d, quote: q}, reviewedBy: e.cuyugan}]`],
  ["unknown status", `patient: SYN-1\nfacts: [{fact: age, value: 64, status: maybe, extractedBy: pipeline}]`],
  ["CamelCase fact name", `patient: SYN-1\nfacts: [{fact: nyhaClass, value: III, status: confirmed, extractedBy: human, reviewedBy: e, reviewedAt: t}]`],
  ["unknown provenance tier", `patient: SYN-1\nfacts: [{fact: age, value: 64, status: confirmed, extractedBy: intern, reviewedBy: e, reviewedAt: t}]`],
  ["confidence above 1", `patient: SYN-1\nfacts: [{fact: lvef, value: 32, status: proposed, confidence: 1.4, extractedBy: llm/m, source: {doc: d, quote: q}}]`],
];

describe("schema and reference parser agree on malformed facts files", () => {
  it.each(BAD_FACTS_FILES)("rejects: %s", (_name, yaml) => {
    expect(validate(FACTS_FILE, parseYaml(yaml)).length).toBeGreaterThan(0);
    expect(() => parseFactsFile(yaml)).toThrow();
  });

  it("rejects the repo's own bad fixture (confirmed with no reviewer)", () => {
    const yaml = readFileSync(resolve(repo, "tests/fixtures/facts-bad/SYN-902.yaml"), "utf8");
    expect(validate(FACTS_FILE, parseYaml(yaml)).length).toBeGreaterThan(0);
    expect(() => parseFactsFile(yaml)).toThrow();
  });
});

/**
 * Where the published format is deliberately stricter than the reference
 * implementation. Each of these is listed in FORMAT.md; asserting them here
 * means closing one is a test change, not a silent drift.
 */
describe("source provenance is registry-agnostic", () => {
  it("accepts a rule set sourced from ISRCTN as readily as from ClinicalTrials.gov", () => {
    const yaml = `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\nsource: {registry: isrctn.com, id: ISRCTN12345678, url: "https://www.isrctn.com/ISRCTN12345678"}\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`;
    expect(validate(RULESET, parseYaml(yaml))).toEqual([]);
    expect(parseRuleSet(yaml).source).toEqual({
      registry: "isrctn.com",
      id: "ISRCTN12345678",
      url: "https://www.isrctn.com/ISRCTN12345678",
    });
  });
});

describe("schema and reference parser agree on governance constraints", () => {
  const cases: [name: string, yaml: string][] = [
    ["rulesetVersion must be semver", `ruleset: x\nrulesetVersion: "1.0"\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
    ["effective must be a real date", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\neffective: 2026-99-99\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
    ["source must not be empty", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\nsource: {}\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}]`],
    ["code values must be strings", `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: exclusion, verbatim: v, when: {fact: conditions, op: in, codes: {system: snomed, values: [88805009]}}}]`],
  ];

  it.each(cases)("%s", (_name, yaml) => {
    expect(validate(RULESET, parseYaml(yaml)).length).toBeGreaterThan(0);
    expect(() => parseRuleSet(yaml)).toThrow();
  });

  it("the parser enforces uniqueness of criterion ids; JSON Schema cannot", () => {
    const yaml = `ruleset: x\nrulesetVersion: 1.0.0\nfactModel: patient-facts/v1\ncriteria: [{id: a, kind: inclusion, verbatim: v, when: {fact: age, op: gte, value: 18}}, {id: a, kind: exclusion, verbatim: w, when: {fact: age, op: lt, value: 90}}]`;
    expect(validate(RULESET, parseYaml(yaml))).toEqual([]);
    expect(() => parseRuleSet(yaml)).toThrow(/duplicate criterion ids/);
  });

  it("the parser enforces one live entry per fact name; JSON Schema cannot", () => {
    const yaml = `patient: SYN-1\nfacts: [{fact: age, value: 64, status: confirmed, extractedBy: pipeline}, {fact: age, value: 71, status: confirmed, extractedBy: pipeline}]`;
    expect(validate(FACTS_FILE, parseYaml(yaml))).toEqual([]);
    expect(() => parseFactsFile(yaml)).toThrow(/duplicate live entries/);
  });
});
