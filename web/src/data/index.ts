/**
 * Bundled demo data. Everything here is synthetic and ships with the app —
 * the workbench makes no network calls (design spec §14, §15).
 *
 * The rule sets, the fact model, the rule-test suite and the patient corpus are
 * NOT copies: they are the canonical repo files, pulled in by Vite at build
 * time (`?raw` / `import.meta.glob`) from `rules/`, `packs/` and `fixtures/`.
 * The workbench and the CLI therefore cannot drift — a change to the canonical
 * YAML is a change to the demo, and the root suite's `demo-content.test.ts`
 * guards the same bytes.
 *
 * The one workbench-only file is `enrolled.json`: already-randomized
 * participants have no canonical home in the repo (the CLI has nowhere to put
 * them), so they live here, marked as demo data.
 */
import { parsePatient, type PatientFacts } from "../../../src/core/schema.js";
import rulesetV110 from "../../../rules/trials/demo-hf-001/ruleset.yaml?raw";
import rulesetV100 from "../../../rules/trials/demo-hf-001/ruleset@1.0.0.yaml?raw";
import factModelYaml from "../../../packs/trials/fact-model.yaml?raw";
import testsYaml from "../../../rules/trials/demo-hf-001/tests.yaml?raw";
import enrolledJson from "./enrolled.json";

export type EnrolledParticipant = {
  participant: string;
  site: string;
  randomized: string;
  patient: PatientFacts;
};

export const DEMO_RULESET_CURRENT = rulesetV110;
export const DEMO_RULESET_PRIOR = rulesetV100;
export const DEMO_FACT_MODEL = factModelYaml;
export const DEMO_TESTS = testsYaml;

/** `fixtures/patients/*.yaml`, in filename order — the CLI's `--corpus` directory. */
const fixtureFiles = import.meta.glob("../../../fixtures/patients/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Each entry is round-tripped through the core parser, so bad demo data fails loudly. */
export const DEMO_COHORT: PatientFacts[] = Object.keys(fixtureFiles)
  .sort()
  .map((path) => parsePatient(fixtureFiles[path]!));

export const DEMO_ENROLLED: EnrolledParticipant[] = enrolledJson.enrolled.map((e) => ({
  participant: e.participant,
  site: e.site,
  randomized: e.randomized,
  patient: parsePatient(JSON.stringify({ patient: e.participant, facts: e.facts })),
}));

export const DEMO_TRIAL = {
  id: "DEMO-HF-001",
  title: "Anticoagulation in HFrEF · synthetic protocol",
  protocolPill: "v3.0 · Amd 2 · effective 04-Aug-2026",
  cohortNote: "synthetic fixtures · fixtures/patients · Site 002",
  amendment: {
    fromLabel: "Protocol v2.0",
    toLabel: "Protocol v3.0 (Amendment 2)",
    dates: "sponsor-issued 14-Jul-2026 · IRB-approved 28-Jul-2026 · site-effective 04-Aug-2026",
  },
} as const;

/** "female · 63y" for the flip table and drill-down header. */
export function demographics(p: PatientFacts): string {
  const sex = typeof p.facts.sex === "string" ? p.facts.sex : "?";
  const age = typeof p.facts.age === "number" ? `${p.facts.age}y` : "age ?";
  return `${sex} · ${age}`;
}
