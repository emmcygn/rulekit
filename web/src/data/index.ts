/**
 * Bundled demo data. Everything here is synthetic and ships with the app —
 * the workbench makes no network calls (design spec §14, §15).
 */
import { parsePatient, type PatientFacts } from "../../../src/core/schema.js";
import rulesetV110 from "./ruleset-v1.1.0.yaml?raw";
import rulesetV100 from "./ruleset-v1.0.0.yaml?raw";
import factModelYaml from "./fact-model.yaml?raw";
import testsYaml from "./tests.yaml?raw";
import cohortJson from "./cohort.json";

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

/** Each entry is round-tripped through the core parser, so bad demo data fails loudly. */
export const DEMO_COHORT: PatientFacts[] = cohortJson.cohort.map((p) =>
  parsePatient(JSON.stringify(p)),
);

export const DEMO_ENROLLED: EnrolledParticipant[] = cohortJson.enrolled.map((e) => ({
  participant: e.participant,
  site: e.site,
  randomized: e.randomized,
  patient: parsePatient(JSON.stringify({ patient: e.participant, facts: e.facts })),
}));

export const DEMO_TRIAL = {
  id: "DEMO-HF-001",
  title: "Anticoagulation in HFrEF · synthetic protocol",
  protocolPill: "v3.0 · Amd 2 · effective 04-Aug-2026",
  cohortNote: "synthetic (Synthea-shaped) · encounters 01-Jan-2024 – 30-Jun-2026 · Site 002",
  amendment: {
    fromLabel: "Protocol v2.0",
    toLabel: "Protocol v3.0 (Amendment 2)",
    dates: "sponsor-issued 14-Jul-2026 · IRB-approved 28-Jul-2026 · site-effective 04-Aug-2026",
  },
} as const;

/** "F · 63y" for the flip table and drill-down header. */
export function demographics(p: PatientFacts): string {
  const sex = typeof p.facts.sex === "string" ? p.facts.sex : "?";
  const age = typeof p.facts.age === "number" ? `${p.facts.age}y` : "age ?";
  return `${sex} · ${age}`;
}
