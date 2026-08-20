#!/usr/bin/env tsx
/**
 * Stage 1: Synthea FHIR R4 bundles -> `corpus/patients/*.yaml` (PatientFacts).
 *
 * The pure half lives in scripts/lib/flatten.ts and is unit-tested; this file
 * is the CLI around it — pick bundles, run them through, write YAML.
 *
 * What it emits per patient: `age`, `sex`, `conditions` (SNOMED + daysAgo),
 * `medications` (RxNorm + daysAgo, most recent request per drug), and for each
 * lab in scripts/lib/loinc.ts four facts — `lab_x`, `lab_x_unit`,
 * `lab_x_code`, `lab_x_days_ago`. Units and source codes are separate facts
 * on purpose: the mess stage corrupts them and the normalize stage repairs
 * them, which is the whole point of the pipeline.
 *
 * Selection and mutation (documented here because it shapes every downstream
 * number): Synthea skews primary-care, so of the ~100 patients emitted the
 * first N (default 40) are every patient carrying a heart-failure SNOMED code,
 * in filename order; the rest fill from the oldest non-HF patients so age and
 * renal criteria have something to bite on. The HF subset then gets the
 * cardiology facts Synthea never produces — LVEF, BNP/NT-proBNP, HF symptom
 * duration, index-event recency, index hospital stay, plus occasional
 * stroke / atrial-fibrillation codes and anticoagulant prescriptions. The
 * exact mutation and its rates are in the `mutateForHf` doc comment; it is
 * seeded, so the corpus is reproducible.
 *
 *   npx tsx scripts/flatten-synthea.ts [--count 100] [--hf 40] [--seed 42]
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { PatientFacts } from "../src/core/schema.js";
import { findBundleDir } from "./lib/bundles.js";
import { flattenBundle, isHfPatient, mutateForHf } from "./lib/flatten.js";
import { REFERENCE_DATE, REPO_ROOT } from "./lib/paths.js";

const SYNTHEA_DIR = join(REPO_ROOT, "data", "synthea");
const OUT_DIR = join(REPO_ROOT, "corpus", "patients");

export function writePatient(dir: string, p: PatientFacts, header: string[]): void {
  const body = stringify(p, { lineWidth: 0, sortMapEntries: false });
  writeFileSync(join(dir, `${p.patient}.yaml`), `${header.map((l) => `# ${l}`).join("\n")}\n${body}`);
}

function flag(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) throw new Error(`--${name} needs a number`);
  return v;
}

function main(argv: string[]): void {
  const count = flag(argv, "count", 100);
  const hfTarget = flag(argv, "hf", 40);
  const seed = flag(argv, "seed", 42);

  const dir = findBundleDir(SYNTHEA_DIR);
  if (!dir) throw new Error(`no Synthea bundles under ${SYNTHEA_DIR} — run scripts/fetch-synthea.ts first`);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !/^(hospital|practitioner)/i.test(f))
    .sort();

  const hf: PatientFacts[] = [];
  const rest: PatientFacts[] = [];
  let skipped = 0;
  for (const f of files) {
    let facts: PatientFacts;
    try {
      facts = flattenBundle(JSON.parse(readFileSync(join(dir, f), "utf8")), { referenceDate: REFERENCE_DATE });
    } catch {
      skipped++;
      continue;
    }
    (isHfPatient(facts) ? hf : rest).push(facts);
  }

  const chosenHf = hf.slice(0, hfTarget).map((p) => mutateForHf(p, seed));
  // Oldest non-HF patients first: age, renal and med-recency criteria all have
  // more to say about 60-year-olds than about paediatric visits.
  const fill = rest
    .slice()
    .sort((a, b) => Number(b.facts["age"] ?? 0) - Number(a.facts["age"] ?? 0) || a.patient.localeCompare(b.patient))
    .slice(0, Math.max(0, count - chosenHf.length));

  const corpus = [...chosenHf, ...fill].sort((a, b) => a.patient.localeCompare(b.patient));

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const p of corpus) {
    writePatient(OUT_DIR, p, [
      `rulekit corpus patient — flattened from Synthea FHIR R4 sample data (Apache-2.0).`,
      `reference date ${REFERENCE_DATE}; recency is measured on the shifted timeline (see docs/data-pipeline.md).`,
      isHfPatient(p) ? `heart-failure subset: cardiology facts injected by mutateForHf(seed=${seed}).` : `unmutated.`,
    ]);
  }

  process.stderr.write(
    `wrote ${corpus.length} patients to ${OUT_DIR} ` +
      `(${chosenHf.length} heart-failure of ${hf.length} available, ${fill.length} fill, ${skipped} bundles skipped)\n`,
  );
}

try {
  main(process.argv.slice(2));
} catch (err: unknown) {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
}
