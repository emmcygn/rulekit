#!/usr/bin/env node
import { Command } from "commander";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  VERSION,
  parseRuleSet, parseFactModel, parsePatient, parseTestSuite,
  checkRuleSet, lintPatient, runSuite, deadRules, structuralDiff, behavioralDiff, versionWarning,
  computeAttrition, soleReasonCriterionId,
  type Attrition, type Evaluation, type Finding, type Overall, type PatientBand, type PatientFacts, type RuleSet,
} from "../core/index.js";

const read = (p: string): string => readFileSync(p, "utf8");
const loadCorpus = (dir: string): PatientFacts[] =>
  readdirSync(dir).filter((f: string) => f.endsWith(".yaml")).map((f: string) => parsePatient(read(join(dir, f))));

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function engineCommit(): string | null {
  if (process.env.RULEKIT_COMMIT !== undefined && process.env.RULEKIT_COMMIT !== "") return process.env.RULEKIT_COMMIT;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function isoDate(value: string, option: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${option} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${option} must be a real calendar date`);
  }
  return value;
}

type ScreenMetadata = {
  schemaVersion: "rulekit-screen/v1";
  engine: { version: string; commit: string | null };
  ruleset: { id: string; version: string; contentHash: string; status: string | null; effective: string | null };
  factModel: { id: string; contentHash: string };
  input: { kind: "corpus"; contentHash: string; patientCount: number };
  evaluation: { asOf: string; timestamp: string };
  modeling: {
    status: "fully-modeled" | "partial";
    declarationHash: string | null;
    criteria: { total: number; modeled: number; partial: number; unmodeled: number };
    partialCriteria: { id: string; note: string }[];
    unmodeledCriteria: string[];
  };
  warnings: { code: string; message: string; criteria: string[] }[];
};

type ModelingDeclaration = {
  hash: string | null;
  partialCriteria: { id: string; note: string }[];
};

function loadModelingDeclaration(rulesetPath: string, rs: RuleSet): ModelingDeclaration {
  const path = join(dirname(rulesetPath), "ruleset.modeling.json");
  if (!existsSync(path)) return { hash: null, partialCriteria: [] };
  const text = read(path);
  const raw = JSON.parse(text) as { ruleset?: unknown; rulesetVersion?: unknown; partialCriteria?: unknown };
  if (raw.ruleset !== rs.ruleset || raw.rulesetVersion !== rs.rulesetVersion || !Array.isArray(raw.partialCriteria)) {
    throw new Error(`${path}: modeling declaration must match ruleset ${rs.ruleset} ${rs.rulesetVersion} and contain partialCriteria[]`);
  }
  const ids = new Set<string>();
  const partialCriteria = raw.partialCriteria.map((entry, index) => {
    if (entry === null || typeof entry !== "object") throw new Error(`${path}: partialCriteria[${index}] must be an object`);
    const { id, note } = entry as { id?: unknown; note?: unknown };
    if (typeof id !== "string" || typeof note !== "string" || note.trim() === "") {
      throw new Error(`${path}: partialCriteria[${index}] needs non-empty string id and note`);
    }
    const criterion = rs.criteria.find((candidate) => candidate.id === id);
    if (criterion === undefined) throw new Error(`${path}: partial criterion "${id}" is not in the ruleset`);
    if (criterion.unmodeled === true) throw new Error(`${path}: "${id}" cannot be both partial and unmodeled`);
    if (ids.has(id)) throw new Error(`${path}: duplicate partial criterion "${id}"`);
    ids.add(id);
    return { id, note };
  });
  return { hash: sha256(text), partialCriteria };
}

function screenMetadata(
  rs: RuleSet,
  rsText: string,
  fm: ReturnType<typeof parseFactModel>,
  fmText: string,
  inputs: { patient: PatientFacts; hash: string }[],
  declaration: ModelingDeclaration,
  asOf: string,
  timestamp: string,
): ScreenMetadata {
  const unmodeledCriteria = rs.criteria.filter((c) => c.unmodeled === true).map((c) => c.id);
  const partial = unmodeledCriteria.length > 0 || declaration.partialCriteria.length > 0;
  const warnings: ScreenMetadata["warnings"] = [];
  if (declaration.partialCriteria.length > 0) {
    warnings.push({
      code: "partial-criteria",
      criteria: declaration.partialCriteria.map((criterion) => criterion.id),
      message: `${declaration.partialCriteria.length} executable criterion translation(s) omit part of the verbatim requirement; affected verdicts are incomplete`,
    });
  }
  if (unmodeledCriteria.length > 0) {
    warnings.push({
      code: "unmodeled-criteria",
      criteria: unmodeledCriteria,
      message: `${unmodeledCriteria.length} criterion/criteria are unmodeled and always evaluate unknown; full-protocol human review is required`,
    });
  }
  return {
    schemaVersion: "rulekit-screen/v1",
    engine: { version: VERSION, commit: engineCommit() },
    ruleset: {
      id: rs.ruleset,
      version: rs.rulesetVersion,
      contentHash: sha256(rsText),
      status: rs.status ?? null,
      effective: rs.effective ?? null,
    },
    factModel: { id: fm.name, contentHash: sha256(fmText) },
    input: {
      kind: "corpus",
      contentHash: sha256(JSON.stringify(inputs.map((entry) => ({ patient: entry.patient.patient, hash: entry.hash })).sort((a, b) => a.patient.localeCompare(b.patient)))),
      patientCount: inputs.length,
    },
    evaluation: { asOf, timestamp },
    modeling: {
      status: partial ? "partial" : "fully-modeled",
      declarationHash: declaration.hash,
      criteria: {
        total: rs.criteria.length,
        modeled: rs.criteria.length - unmodeledCriteria.length,
        partial: declaration.partialCriteria.length,
        unmodeled: unmodeledCriteria.length,
      },
      partialCriteria: declaration.partialCriteria,
      unmodeledCriteria,
    },
    warnings,
  };
}

function corpusFindings(corpus: PatientFacts[], fm: ReturnType<typeof parseFactModel>): Finding[] {
  const findings = corpus.flatMap((p) => lintPatient(p, fm));
  const seen = new Set<string>();
  for (const p of corpus) {
    if (seen.has(p.patient)) findings.push({ level: "error", code: "duplicate-patient", criteria: [], message: `patient id "${p.patient}" appears more than once in the corpus` });
    seen.add(p.patient);
  }
  return findings;
}

function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.level === "error");
}

function printFindings(findings: Finding[]): void {
  for (const level of ["error", "warning", "info"] as const) {
    for (const f of findings.filter((x) => x.level === level)) {
      const tag = level === "error" ? "✕" : level === "warning" ? "!" : "i";
      console.log(`${tag} ${level.toUpperCase()} ${f.code} [${f.criteria.join(", ")}] ${f.message}`);
      if (f.evidence !== undefined) console.log(`    ${f.evidence}`);
    }
  }
}

const program = new Command().name("rules").description("rulekit — eligibility criteria as code");

program.command("check")
  .argument("<ruleset>").requiredOption("--fact-model <path>")
  .action((rulesetPath: string, opts: { factModel: string }) => {
    const findings = checkRuleSet(parseRuleSet(read(rulesetPath)), parseFactModel(read(opts.factModel)));
    printFindings(findings);
    const errors = findings.filter((f) => f.level === "error").length;
    const warnings = findings.filter((f) => f.level === "warning").length;
    // A clean run is not a universal proof. Unsupported branches receive an
    // `analysis-incomplete` finding, so the summary names the proof families
    // without implying that every possible logical interaction was solved.
    console.log(
      errors === 0 && warnings === 0
        ? "0 conflict(s), 0 warning(s) — static analysis covers interval and direct code-set proofs; incomplete criteria are labeled above."
        : `${errors} conflict(s), ${warnings} warning(s)`,
    );
    if (errors > 0) process.exitCode = 1;
  });

program.command("test")
  .argument("<dir>").requiredOption("--fact-model <path>").option("--corpus <dir>")
  .option("--coverage", "fail when a modeled criterion is not exercised in both pass and fail directions")
  .action((dir: string, opts: { factModel: string; corpus?: string; coverage?: boolean }) => {
    const rs = parseRuleSet(read(join(dir, "ruleset.yaml")));
    const fm = parseFactModel(read(opts.factModel));
    const ruleFindings = checkRuleSet(rs, fm);
    printFindings(ruleFindings);
    if (hasErrors(ruleFindings)) {
      process.exitCode = 1;
      return;
    }
    const suite = parseTestSuite(read(join(dir, "tests.yaml")));
    const suiteFindings = corpusFindings(suite.cases.map((tc) => ({ patient: tc.name, facts: tc.facts })), fm);
    printFindings(suiteFindings);
    if (hasErrors(suiteFindings)) {
      process.exitCode = 1;
      return;
    }
    const result = runSuite(rs, suite);
    for (const c of result.cases.filter((x) => !x.ok)) {
      console.log(`FAIL ${c.name}`);
      for (const m of c.mismatches) console.log(`  ${m.key}: expected ${m.expected}, got ${m.actual}`);
    }
    console.log(`${result.cases.filter((c) => c.ok).length}/${result.cases.length} cases pass`);
    console.log("coverage (pass/fail/unknown):");
    for (const c of result.coverage) {
      console.log(`  ${c.criterion}: ${c.pass}/${c.fail}/${c.unknown}${c.gaps.length > 0 ? `  ⚠ ${c.gaps.join(", ")}` : ""}`);
    }
    if (opts.corpus !== undefined) {
      const corpus = loadCorpus(opts.corpus);
      const findings = corpusFindings(corpus, fm);
      printFindings(findings);
      if (hasErrors(findings)) process.exitCode = 1;
      else {
        console.log(`corpus dead-rule scan (${corpus.length} patients):`);
        for (const d of deadRules(rs, corpus)) console.log(`⚠ dead rule: ${d.criterion} — ${d.reason}`);
      }
    }
    if (!result.ok || (opts.coverage === true && result.coverage.some((c) => c.gaps.length > 0))) process.exitCode = 1;
  });

program.command("diff")
  .argument("<a>").argument("<b>").requiredOption("--corpus <dir>").requiredOption("--fact-model <path>")
  .action((aPath: string, bPath: string, opts: { corpus: string; factModel: string }) => {
    const a = parseRuleSet(read(aPath));
    const b = parseRuleSet(read(bPath));
    const fm = parseFactModel(read(opts.factModel));
    const findings = [...checkRuleSet(a, fm), ...checkRuleSet(b, fm), ...corpusFindings(loadCorpus(opts.corpus), fm)];
    printFindings(findings);
    if (hasErrors(findings)) {
      process.exitCode = 1;
      return;
    }
    let s;
    try {
      s = structuralDiff(a, b);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    console.log(`rulesetVersion ${a.rulesetVersion} → ${b.rulesetVersion}`);
    for (const id of s.added) console.log(`+ added ${id}`);
    for (const id of s.removed) console.log(`- removed ${id}`);
    for (const id of s.changed) console.log(`~ changed ${id}`);
    for (const rename of s.renamed) console.log(`~ renamed ${rename.from} → ${rename.to}`);
    if (s.reordered.length > 0) console.log(`~ reordered ${s.reordered.join(", ")}`);
    for (const field of s.metadataChanged) console.log(`~ metadata ${field}`);
    const stale = versionWarning(a, b, s);
    const [aMajor, aMinor, aPatch] = a.rulesetVersion.split(".").map(Number) as [number, number, number];
    const [bMajor, bMinor, bPatch] = b.rulesetVersion.split(".").map(Number) as [number, number, number];
    const comparison = bMajor !== aMajor ? Math.sign(bMajor - aMajor) : bMinor !== aMinor ? Math.sign(bMinor - aMinor) : Math.sign(bPatch - aPatch);
    const aById = new Map(a.criteria.map((criterion) => [criterion.id, criterion]));
    const behaviorChanged = s.added.length + s.removed.length + s.renamed.length > 0 || b.criteria.some((criterion) => {
      const before = aById.get(criterion.id);
      return before !== undefined && JSON.stringify(canonical({ kind: before.kind, when: before.when ?? null, unmodeled: before.unmodeled ?? false }))
        !== JSON.stringify(canonical({ kind: criterion.kind, when: criterion.when ?? null, unmodeled: criterion.unmodeled ?? false }));
    });
    const breakingChange = s.removed.length + s.renamed.length > 0 || b.criteria.some((criterion) => {
      const before = aById.get(criterion.id);
      return before !== undefined && before.kind !== criterion.kind;
    });
    const anyChange = s.added.length + s.removed.length + s.changed.length + s.renamed.length + s.reordered.length + s.metadataChanged.length > 0;
    let versionError: string | undefined;
    if (comparison < 0) {
      versionError = `rulesetVersion regressed from ${a.rulesetVersion} to ${b.rulesetVersion}`;
    } else if (stale !== undefined) {
      versionError = stale;
    } else if (breakingChange && bMajor === aMajor) {
      versionError = `criterion removal, rename, or kind inversion requires a major bump; got ${a.rulesetVersion} → ${b.rulesetVersion}`;
    } else if (behaviorChanged && bMajor === aMajor && bMinor === aMinor) {
      versionError = `criterion behavior or identity changed in patch release ${a.rulesetVersion} → ${b.rulesetVersion}; use at least a minor bump`;
    } else if (!anyChange && comparison > 0) {
      console.log(`! WARNING empty-version-bump files are structurally identical but rulesetVersion changed`);
    }
    if (versionError !== undefined) {
      console.log(`✕ ERROR invalid-version-bump ${versionError}`);
      process.exitCode = 1;
    }
    const flips = behavioralDiff(a, b, loadCorpus(opts.corpus));
    console.log(`${flips.length} patient(s) flip:`);
    for (const f of flips) console.log(`  ${f.patient}: ${f.from} → ${f.to}  (${f.responsible.join(", ")})`);
  });

const BAND_LABEL: Record<PatientBand, string> = {
  "potentially-eligible": "potentially eligible",
  "screen-fail": "screen fail",
  "not-evaluable": "not evaluable",
};

function screenReport(rs: RuleSet, a: Attrition, metadata: ScreenMetadata): string {
  const pct = (k: number): string => (a.n === 0 ? "—" : `${((k / a.n) * 100).toFixed(1)}%`);
  const label = (r: { id: string; ref?: string }): string => (r.ref === undefined ? r.id : `${r.ref} · ${r.id}`);

  const soleByCriterion = new Map<string, string[]>();
  for (const p of a.patients) {
    const id = soleReasonCriterionId(p.evaluation);
    if (id !== undefined) soleByCriterion.set(id, [...(soleByCriterion.get(id) ?? []), p.patient]);
  }

  const lines: string[] = [
    "---",
    `schemaVersion: ${JSON.stringify("rulekit-screen-report/v1")}`,
    `engineVersion: ${JSON.stringify(metadata.engine.version)}`,
    `engineCommit: ${JSON.stringify(metadata.engine.commit)}`,
    `ruleset: ${JSON.stringify(metadata.ruleset.id)}`,
    `rulesetVersion: ${JSON.stringify(metadata.ruleset.version)}`,
    `rulesetHash: ${JSON.stringify(metadata.ruleset.contentHash)}`,
    `rulesetStatus: ${JSON.stringify(metadata.ruleset.status)}`,
    `rulesetEffective: ${JSON.stringify(metadata.ruleset.effective)}`,
    `factModel: ${JSON.stringify(metadata.factModel.id)}`,
    `factModelHash: ${JSON.stringify(metadata.factModel.contentHash)}`,
    `inputHash: ${JSON.stringify(metadata.input.contentHash)}`,
    `evaluationAsOf: ${JSON.stringify(metadata.evaluation.asOf)}`,
    `evaluationTimestamp: ${JSON.stringify(metadata.evaluation.timestamp)}`,
    `modelingStatus: ${JSON.stringify(metadata.modeling.status)}`,
    `modelingDeclarationHash: ${JSON.stringify(metadata.modeling.declarationHash)}`,
    `partialCriteria: ${JSON.stringify(metadata.modeling.partialCriteria.map((criterion) => criterion.id))}`,
    `unmodeledCriteria: ${JSON.stringify(metadata.modeling.unmodeledCriteria)}`,
    `warnings: ${JSON.stringify(metadata.warnings.map((warning) => warning.code))}`,
    "---",
    "",
    `# Screening report — ${rs.ruleset} ${rs.rulesetVersion}`,
    "",
    `Engine ${metadata.engine.version}${metadata.engine.commit === null ? " (commit unavailable)" : ` · commit ${metadata.engine.commit}`} · evaluated ${metadata.evaluation.timestamp} · as of ${metadata.evaluation.asOf}.`,
    `Ruleset ${metadata.ruleset.contentHash} · fact model ${metadata.factModel.contentHash} · input ${metadata.input.contentHash}.`,
    "",
    ...(metadata.modeling.status === "partial"
      ? [
          `> **PARTIAL RULESET WARNING:** ${metadata.modeling.criteria.partial} criteria are partially translated (${metadata.modeling.partialCriteria.map((criterion) => criterion.id).join(", ") || "none"}); ${metadata.modeling.criteria.unmodeled} are unmodeled (${metadata.modeling.unmodeledCriteria.join(", ") || "none"}). This report is incomplete and requires full-protocol human review.`,
          "",
        ]
      : []),
    `${a.n} patient(s) screened against ${rs.criteria.length} criteria (${a.rows.filter((r) => r.unmodeled).length} unmodeled).`,
    "",
    "## Bands",
    "",
    "Every band comes from the engine's overall verdict for that patient, so the",
    "three numbers below and the per-criterion table can never tell different stories.",
    "",
    "| Band | Patients | Share |",
    "| --- | ---: | ---: |",
    ...(["potentially-eligible", "screen-fail", "not-evaluable"] as PatientBand[]).map(
      (b) => `| ${BAND_LABEL[b]} | ${a.bands[b]} | ${pct(a.bands[b])} |`,
    ),
    "",
    "## Per-criterion attrition",
    "",
    "- **sequential** — screen failures whose *first* failing criterion is this one; sums to the screen-fail band.",
    "- **fails alone** — patients this criterion fails anywhere in the cohort, ignoring order.",
    "- **sole reason** — patients it alone keeps out: it fails and every other criterion passes.",
    "",
    "| Criterion | Kind | Sequential | Fails alone | Sole reason |",
    "| --- | --- | ---: | ---: | ---: |",
    ...a.rows.map(
      (r) =>
        `| ${label(r)} | ${r.kind}${r.unmodeled ? " (unmodeled)" : ""} | ${r.unmodeled ? "—" : r.removedSequential} | ${r.unmodeled ? "—" : r.failsAlone} | ${r.unmodeled ? "—" : r.soleReason} |`,
    ),
    "",
    "## Sole-disqualifier argument",
    "",
    "Patients who would move to *potentially eligible* if this one criterion were",
    "relaxed, and nothing else changed. Every other criterion must pass; an",
    "unknown or unresolved criterion prevents a sole-reason claim.",
    "",
  ];

  const withSole = a.rows.filter((r) => r.soleReason > 0);
  if (withSole.length === 0) {
    lines.push("No criterion is any patient's sole disqualifier in this cohort.", "");
  } else {
    for (const r of withSole) {
      lines.push(`### ${label(r)} — ${r.soleReason} patient(s)`, "", `> ${rs.criteria.find((c) => c.id === r.id)!.verbatim}`, "");
      for (const p of soleByCriterion.get(r.id) ?? []) lines.push(`- ${p}`);
      lines.push("");
    }
  }

  lines.push(
    "---",
    "",
    "Generated by `rules screen --report`. Synthetic data, demonstration tooling —",
    "not for clinical, feasibility, or research screening use. Metadata records",
    "the selected artifact; it does not verify approval or regulatory compliance.",
    "",
  );
  return lines.join("\n");
}

program.command("screen")
  .argument("<ruleset>").requiredOption("--corpus <dir>").requiredOption("--fact-model <path>")
  .option("--out <file>", "counts + per-patient evaluations as JSON")
  .option("--report <file.md>", "cohort attrition as a markdown report")
  .option("--as-of <YYYY-MM-DD>", "date relative daysAgo facts are interpreted against (defaults to the UTC run date)")
  .action((rulesetPath: string, opts: { corpus: string; factModel: string; out?: string; report?: string; asOf?: string }) => {
    if (opts.out === undefined && opts.report === undefined) {
      console.error("screen: give --out <file.json>, --report <file.md>, or both");
      process.exitCode = 1;
      return;
    }
    const timestamp = new Date().toISOString();
    let asOf: string;
    try {
      asOf = isoDate(opts.asOf ?? timestamp.slice(0, 10), "--as-of");
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    const rsText = read(rulesetPath);
    const fmText = read(opts.factModel);
    const rs = parseRuleSet(rsText);
    const inputFiles = readdirSync(opts.corpus).filter((f: string) => f.endsWith(".yaml")).sort();
    const inputs = inputFiles.map((file) => {
      const text = read(join(opts.corpus, file));
      return { patient: parsePatient(text), hash: sha256(text) };
    });
    const corpus = inputs.map((entry) => entry.patient);
    const fm = parseFactModel(fmText);
    const findings = [...checkRuleSet(rs, fm), ...corpusFindings(corpus, fm)];
    printFindings(findings);
    if (hasErrors(findings)) {
      process.exitCode = 1;
      return;
    }
    let declaration: ModelingDeclaration;
    try {
      declaration = loadModelingDeclaration(rulesetPath, rs);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    const attrition = computeAttrition(rs, corpus);
    const patients: Evaluation[] = attrition.patients.map((p) => p.evaluation);
    const metadata = screenMetadata(rs, rsText, fm, fmText, inputs, declaration, asOf, timestamp);
    const inputHashByPatient = new Map(inputs.map((entry) => [entry.patient.patient, entry.hash]));
    const counts: Record<Overall, number> = { eligible: 0, ineligible: 0, undetermined: 0 };
    for (const p of patients) counts[p.overall] += 1;
    const patientOutputs = patients.map((evaluation) => ({
      ...evaluation,
      metadata: {
        engine: metadata.engine,
        ruleset: metadata.ruleset,
        factModel: metadata.factModel,
        inputHash: inputHashByPatient.get(evaluation.patient)!,
        evaluation: metadata.evaluation,
        modelingStatus: metadata.modeling.status,
        partialCriteria: metadata.modeling.partialCriteria,
        unmodeledCriteria: metadata.modeling.unmodeledCriteria,
        warnings: metadata.warnings.map((warning) => warning.code),
      },
    }));
    if (opts.out !== undefined) writeFileSync(opts.out, JSON.stringify({ metadata, counts, patients: patientOutputs }, null, 2));
    if (opts.report !== undefined) writeFileSync(opts.report, screenReport(rs, attrition, metadata));
    const written = [opts.out, opts.report].filter((f): f is string => f !== undefined).join(", ");
    console.log(`screened ${patients.length}: ${counts.eligible} eligible · ${counts.ineligible} ineligible · ${counts.undetermined} undetermined → ${written}`);
  });

program.parse();
