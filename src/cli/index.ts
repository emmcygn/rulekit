import { Command } from "commander";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRuleSet, parseFactModel, parsePatient, parseTestSuite,
  checkRuleSet, runSuite, deadRules, structuralDiff, behavioralDiff, evalPatient,
  type Finding,
} from "../core/index.js";

const read = (p: string) => readFileSync(p, "utf8");
const loadCorpus = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => parsePatient(read(join(dir, f))));

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
    console.log(`${errors} conflict(s), ${findings.filter((f) => f.level === "warning").length} warning(s)`);
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
    for (const id of s.added) console.log(`+ added ${id}`);
    for (const id of s.removed) console.log(`- removed ${id}`);
    for (const id of s.changed) console.log(`~ changed ${id}`);
    const flips = behavioralDiff(a, b, loadCorpus(opts.corpus));
    console.log(`${flips.length} patient(s) flip:`);
    for (const f of flips) console.log(`  ${f.patient}: ${f.from} → ${f.to}  (${f.responsible.join(", ")})`);
  });

program.command("screen")
  .argument("<ruleset>").requiredOption("--corpus <dir>").requiredOption("--out <file>")
  .action((rulesetPath: string, opts: { corpus: string; out: string }) => {
    const rs = parseRuleSet(read(rulesetPath));
    const patients = loadCorpus(opts.corpus).map((p) => evalPatient(rs, p));
    const counts = { eligible: 0, ineligible: 0, undetermined: 0 };
    for (const p of patients) counts[p.overall] += 1;
    writeFileSync(opts.out, JSON.stringify({ counts, patients }, null, 2));
    console.log(`screened ${patients.length}: ${counts.eligible} eligible · ${counts.ineligible} ineligible · ${counts.undetermined} undetermined → ${opts.out}`);
  });

program.parse();
