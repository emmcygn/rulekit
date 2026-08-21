#!/usr/bin/env node
/**
 * `facts` — the patient-side mirror of `rules` (design spec §11).
 *
 *   facts check <dir>   schema + grounding + recency lint over every facts.yaml
 *   facts eval          fact-level precision/recall + confidence calibration
 *
 * Both exit non-zero on failure, so both are CI gates. `facts check` is the one
 * that matters day to day: facts.yaml is hand-editable and lives in git, so a
 * quote can drift from its note, or a value can be edited into the wrong type,
 * long after the grounding gate first approved it.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { parseFactModel } from "../core/schema.js";
import { parseFactsFile, type FactEntry, type FactsFile } from "../extract/schema.js";
import { verifyFactEntry, type GroundingContext } from "../extract/ground.js";
import { loadNotesDir, toDocuments } from "../extract/notes.js";
import { loadRecorded } from "../extract/recorded.js";
import { parseResponse } from "../extract/pipeline.js";
import { FACT_MODEL_PATH } from "../extract/fact-model.js";
import { groundProposedFacts } from "../extract/ground.js";
import { parseExpectedFacts, scoreExtraction, formatEvalReport, type ScoredCase } from "../extract/eval.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const DEFAULT_NOTES = join(repoRoot, "corpus", "notes");
const DEFAULT_FACT_MODEL = FACT_MODEL_PATH;
const DEFAULT_EXPECTED = join(repoRoot, "evals", "expected-facts.yaml");

type Finding = { file: string; fact?: string; message: string };

const loadContext = (notesDir: string, factModelPath: string): GroundingContext => ({
  factModel: parseFactModel(readFileSync(factModelPath, "utf8")),
  documents: toDocuments(loadNotesDir(notesDir)),
});

const DAY_MS = 86_400_000;

/**
 * A fact may declare how fresh it has to be (`validWithinDays`). Staleness is
 * measured from the file's `asOf` — the screening date — because "is this lab
 * recent enough" is a question about the screening moment, not about when
 * someone happened to run the linter.
 *
 * Deviation from spec §11, recorded honestly: the spec phrases this as "outside
 * a criterion's required window", which needs a rule set in hand. This branch
 * does not touch the rule loader, so the window is declared on the fact itself.
 * Deriving it from `anyWithin` criteria is the natural follow-up.
 */
function checkRecency(entry: FactEntry, asOf: string | undefined, file: string, now: string): Finding[] {
  if (entry.validWithinDays === undefined) return [];
  if (entry.measuredAt === undefined) {
    return [{ file, fact: entry.fact, message: `declares validWithinDays: ${entry.validWithinDays} but has no measuredAt` }];
  }
  const measured = Date.parse(entry.measuredAt);
  const reference = Date.parse(asOf ?? now);
  if (Number.isNaN(measured)) return [{ file, fact: entry.fact, message: `measuredAt '${entry.measuredAt}' is not a date` }];
  if (Number.isNaN(reference)) return [{ file, fact: entry.fact, message: `asOf '${asOf}' is not a date` }];

  const ageDays = Math.floor((reference - measured) / DAY_MS);
  if (ageDays > entry.validWithinDays) {
    return [
      {
        file,
        fact: entry.fact,
        message: `measured ${ageDays}d before ${asOf ?? now}, outside the declared ${entry.validWithinDays}d window`,
      },
    ];
  }
  if (ageDays < 0) {
    return [{ file, fact: entry.fact, message: `measuredAt ${entry.measuredAt} is after ${asOf ?? now}` }];
  }
  return [];
}

function checkFile(path: string, ctx: GroundingContext, now: string): Finding[] {
  const file = basename(path);
  let parsed: FactsFile;
  try {
    parsed = parseFactsFile(readFileSync(path, "utf8"));
  } catch (err) {
    return [{ file, message: (err as Error).message }];
  }

  const findings: Finding[] = [];
  for (const entry of parsed.facts) {
    for (const rejection of verifyFactEntry(entry, ctx)) {
      findings.push({ file, fact: entry.fact, message: rejection.detail });
    }
    findings.push(...checkRecency(entry, parsed.asOf, file, now));
  }
  return findings;
}

const factsFilesIn = (dir: string): string[] => {
  if (!existsSync(dir)) throw new Error(`no such directory: ${dir}`);
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => join(dir, f));
};

const program = new Command();
program.name("facts").description("lint and evaluate patient facts files").version("0.1.0");

program
  .command("check")
  .argument("<dir>", "directory of facts.yaml files (or a single file)")
  .description("validate schema, re-verify quote grounding against the notes, and flag stale measurements")
  .option("--notes <dir>", "directory of source notes", DEFAULT_NOTES)
  .option("--fact-model <path>", "fact model YAML", DEFAULT_FACT_MODEL)
  .option("--as-of <date>", "reference date for recency checks when a file declares no asOf")
  .action((dir: string, opts: { notes: string; factModel: string; asOf?: string }) => {
    const now = opts.asOf ?? new Date().toISOString().slice(0, 10);
    let ctx: GroundingContext;
    let files: string[];
    try {
      ctx = loadContext(resolve(opts.notes), resolve(opts.factModel));
      files = factsFilesIn(resolve(dir));
    } catch (err) {
      process.stderr.write(`facts check: ${(err as Error).message}\n`);
      process.exitCode = 1;
      return;
    }

    if (files.length === 0) {
      process.stdout.write(`facts check: no facts files in ${dir}\n`);
      return;
    }

    const findings = files.flatMap((f) => checkFile(f, ctx, now));
    for (const f of findings) {
      process.stdout.write(`  ${f.file}${f.fact ? ` [${f.fact}]` : ""}: ${f.message}\n`);
    }

    if (findings.length > 0) {
      process.stdout.write(`\nfacts check: ${findings.length} problem(s) in ${files.length} file(s)\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`facts check: ${files.length} file(s) OK\n`);
  });

program
  .command("eval")
  .description("score the recorded extraction run against the authored ground truth")
  .option("--notes <dir>", "directory of source notes", DEFAULT_NOTES)
  .option("--fact-model <path>", "fact model YAML", DEFAULT_FACT_MODEL)
  .option("--expected <path>", "expected-facts YAML", DEFAULT_EXPECTED)
  .option("--recorded <dir>", "recorded responses directory")
  .option("--min-precision <n>", "fail below this precision", parseFloat)
  .option("--min-recall <n>", "fail below this recall", parseFloat)
  .action((opts: { notes: string; factModel: string; expected: string; recorded?: string; minPrecision?: number; minRecall?: number }) => {
    let report;
    try {
      const ctx = loadContext(resolve(opts.notes), resolve(opts.factModel));
      const expected = parseExpectedFacts(readFileSync(resolve(opts.expected), "utf8"));
      const cases: ScoredCase[] = expected.cases.map((c) => {
        const recorded = opts.recorded ? loadRecorded(c.doc, resolve(opts.recorded)) : loadRecorded(c.doc);
        return {
          doc: c.doc,
          expected: c.expected,
          result: groundProposedFacts(parseResponse(recorded.parsed_output), {
            doc: c.doc,
            extractedBy: `llm/${recorded.model}`,
            ctx,
          }),
        };
      });
      report = scoreExtraction(cases);
    } catch (err) {
      process.stderr.write(`facts eval: ${(err as Error).message}\n`);
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`${formatEvalReport(report)}\n`);

    const failures: string[] = [];
    if (opts.minPrecision !== undefined && report.precision < opts.minPrecision) {
      failures.push(`precision ${report.precision.toFixed(3)} < ${opts.minPrecision}`);
    }
    if (opts.minRecall !== undefined && report.recall < opts.minRecall) {
      failures.push(`recall ${report.recall.toFixed(3)} < ${opts.minRecall}`);
    }
    if (failures.length > 0) {
      process.stderr.write(`\nfacts eval: ${failures.join("; ")}\n`);
      process.exitCode = 1;
    }
  });

program.parse();
