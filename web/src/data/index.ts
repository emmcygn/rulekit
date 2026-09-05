/**
 * Bundled demo data. Everything here is synthetic and ships with the app: no
 * patient data, no rule set and no evaluation ever leaves the browser, and the
 * app makes no API calls (design spec §14, §15).
 *
 * It is NOT true that the page makes no network requests at all — `web/index.html`
 * preconnects to fonts.googleapis.com / fonts.gstatic.com and pulls a stylesheet
 * from the former. The page degrades gracefully offline (system-font fallbacks),
 * but the request is real, so the older "no network calls" wording in this
 * comment was wrong and has been removed. Self-host the families to make the
 * stronger claim true.
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
import { parseFactsFile, type FactsFile } from "../../../src/extract/schema.js";
import rulesetV110 from "../../../rules/trials/demo-hf-001/ruleset.yaml?raw";
// 1.0.0 is retained byte-for-byte as historical evidence, including its invalid
// eGFR unit. The workbench uses the corrected 1.0.1 artifact so checked
// evaluation never depends on known-invalid history.
import rulesetV101 from "../../../rules/trials/demo-hf-001/ruleset@1.0.1.yaml?raw";
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
export const DEMO_RULESET_PRIOR = rulesetV101;
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

/**
 * `corpus/facts/*.yaml` — the extraction pipeline's real output, provenance and
 * all, restricted to the patients the demo cohort actually contains. This is
 * what the Review tab queues; the rest of the corpus belongs to patients the
 * funnel never sees, and queuing them would be a review nobody could act on.
 */
const factsFiles = import.meta.glob("../../../corpus/facts/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const cohortIds = new Set(DEMO_COHORT.map((p) => p.patient));

export const DEMO_FACTS: FactsFile[] = Object.keys(factsFiles)
  .sort()
  .map((path) => parseFactsFile(factsFiles[path]!))
  .filter((f) => cohortIds.has(f.patient));

/**
 * `corpus/notes/*.txt` — doc id -> groundable body, front matter stripped, the
 * same split `src/extract/notes.ts` applies. Reimplemented in four lines rather
 * than imported because that module reaches for `node:fs` at load time and this
 * one runs in a browser.
 */
const noteFiles = import.meta.glob("../../../corpus/notes/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function noteBody(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") return lines.join("\n");
  const end = lines.indexOf("---", 1);
  return end === -1 ? lines.join("\n") : lines.slice(end + 1).join("\n");
}

export const DEMO_NOTES: Record<string, string> = Object.fromEntries(
  Object.entries(noteFiles).map(([path, text]) => [
    path.split("/").pop()!.replace(/\.txt$/, ""),
    noteBody(text),
  ]),
);

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
  cohortNote: "synthetic fixtures · fixtures/patients · Site 002 (synthetic demo site)",
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
