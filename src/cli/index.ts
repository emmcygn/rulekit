import { Command } from "commander";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRuleSet, parseFactModel, parsePatient, parseTestSuite,
  checkRuleSet, runSuite, deadRules, structuralDiff, behavioralDiff, versionWarning,
  computeAttrition, soleReasonCriterionId,
  type Attrition, type Evaluation, type Finding, type Overall, type PatientBand, type PatientFacts, type RuleSet,
} from "../core/index.js";

const read = (p: string): string => readFileSync(p, "utf8");
const loadCorpus = (dir: string): PatientFacts[] =>
  readdirSync(dir).filter((f: string) => f.endsWith(".yaml")).map((f: string) => parsePatient(read(join(dir, f))));

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
    // A clean run is not a proof. The analysis is interval arithmetic over
    // single-fact `all` chains: `any`/`not`/code ops and multi-fact exclusions
    // are not analyzed at all, so "0 conflict(s)" and "verified consistent" are
    // very different statements and the output has to say which one this is.
    console.log(
      errors === 0 && warnings === 0
        ? "0 conflict(s), 0 warning(s) — static analysis covers single-fact interval logic; it is not a proof of consistency."
        : `${errors} conflict(s), ${warnings} warning(s)`,
    );
    if (errors > 0) process.exitCode = 1;
  });

program.command("test")
  .argument("<dir>").requiredOption("--fact-model <path>").option("--corpus <dir>")
  .action((dir: string, opts: { factModel: string; corpus?: string }) => {
    const rs = parseRuleSet(read(join(dir, "ruleset.yaml")));
    const result = runSuite(rs, parseTestSuite(read(join(dir, "tests.yaml"))));
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
      for (const d of deadRules(rs, loadCorpus(opts.corpus))) console.log(`⚠ dead rule: ${d.criterion} — ${d.reason}`);
    }
    if (!result.ok) process.exitCode = 1;
  });

program.command("diff")
  .argument("<a>").argument("<b>").requiredOption("--corpus <dir>")
  .action((aPath: string, bPath: string, opts: { corpus: string }) => {
    const a = parseRuleSet(read(aPath));
    const b = parseRuleSet(read(bPath));
    const s = structuralDiff(a, b);
    console.log(`rulesetVersion ${a.rulesetVersion} → ${b.rulesetVersion}`);
    for (const id of s.added) console.log(`+ added ${id}`);
    for (const id of s.removed) console.log(`- removed ${id}`);
    for (const id of s.changed) console.log(`~ changed ${id}`);
    const stale = versionWarning(a, b, s);
    if (stale !== undefined) console.log(`! WARNING unbumped-version ${stale}`);
    const flips = behavioralDiff(a, b, loadCorpus(opts.corpus));
    console.log(`${flips.length} patient(s) flip:`);
    for (const f of flips) console.log(`  ${f.patient}: ${f.from} → ${f.to}  (${f.responsible.join(", ")})`);
  });

const BAND_LABEL: Record<PatientBand, string> = {
  "potentially-eligible": "potentially eligible",
  "screen-fail": "screen fail",
  "not-evaluable": "not evaluable",
};

function screenReport(rs: RuleSet, a: Attrition): string {
  const pct = (k: number): string => (a.n === 0 ? "—" : `${((k / a.n) * 100).toFixed(1)}%`);
  const label = (r: { id: string; ref?: string }): string => (r.ref === undefined ? r.id : `${r.ref} · ${r.id}`);

  const soleByCriterion = new Map<string, string[]>();
  for (const p of a.patients) {
    const id = soleReasonCriterionId(p.evaluation);
    if (id !== undefined) soleByCriterion.set(id, [...(soleByCriterion.get(id) ?? []), p.patient]);
  }

  const lines: string[] = [
    `# Screening report — ${rs.ruleset} ${rs.rulesetVersion}`,
    "",
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
    "- **sole reason** — patients it alone keeps out: it fails and every other modeled criterion passes.",
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
    "relaxed, and nothing else changed. Unmodeled criteria are parked in chart",
    "review rather than drained, so they are not counted here.",
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
    "not for clinical, feasibility, or research screening use.",
    "",
  );
  return lines.join("\n");
}

program.command("screen")
  .argument("<ruleset>").requiredOption("--corpus <dir>")
  .option("--out <file>", "counts + per-patient evaluations as JSON")
  .option("--report <file.md>", "cohort attrition as a markdown report")
  .action((rulesetPath: string, opts: { corpus: string; out?: string; report?: string }) => {
    if (opts.out === undefined && opts.report === undefined) {
      console.error("screen: give --out <file.json>, --report <file.md>, or both");
      process.exitCode = 1;
      return;
    }
    const rs = parseRuleSet(read(rulesetPath));
    const corpus = loadCorpus(opts.corpus);
    const attrition = computeAttrition(rs, corpus);
    const patients: Evaluation[] = attrition.patients.map((p) => p.evaluation);
    const counts: Record<Overall, number> = { eligible: 0, ineligible: 0, undetermined: 0 };
    for (const p of patients) counts[p.overall] += 1;
    if (opts.out !== undefined) writeFileSync(opts.out, JSON.stringify({ counts, patients }, null, 2));
    if (opts.report !== undefined) writeFileSync(opts.report, screenReport(rs, attrition));
    const written = [opts.out, opts.report].filter((f): f is string => f !== undefined).join(", ");
    console.log(`screened ${patients.length}: ${counts.eligible} eligible · ${counts.ineligible} ineligible · ${counts.undetermined} undetermined → ${written}`);
  });

program.parse();
