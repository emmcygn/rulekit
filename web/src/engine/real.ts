/**
 * The workbench's `Engine`, wrapping the rulekit core (src/core) directly.
 *
 * There is no logic here: `evalPatient`, `check` and `behavioralDiff` are core's
 * `evalPatient`, `checkRuleSet` and `behavioralDiff`. The wrapper exists for
 * three reasons, and nothing else belongs in it:
 *
 *  1. The contract in `api.ts` speaks YAML text, because the editor's document
 *     *is* the rule set. Core speaks parsed `RuleSet` objects. This file parses.
 *  2. Parsing is memoized. Dragging a threshold re-evaluates the whole cohort on
 *     every pointer move, which would otherwise re-parse the document per tick.
 *  3. A rule set the author is mid-keystroke on may not parse. The CLI is
 *     allowed to exit non-zero; a live editor is not, so a parse failure becomes
 *     a `Finding` the checks panel can render instead of an exception.
 *
 * Core's own `Finding.code` values are the ones the panel keys on:
 * `unknown-fact`, `type-mismatch`, `unit-mismatch`, `unknown-code-system`,
 * `unmodeled-criterion`, `analysis-incomplete`, `unsatisfiable-ruleset`,
 * `unsatisfiable-criterion`. The
 * two codes below (`schema`, `fact-model-schema`) are this wrapper's, for the
 * failure core has no finding for because it never sees unparsed text.
 */
import {
  behavioralDiff as coreBehavioralDiff,
  checkRuleSet,
  detectConflicts,
  evalPatient as coreEvalPatient,
  parseFactModel,
  parseRuleSet,
  type FactModel,
  type PatientFacts,
  type RuleSet,
} from "../../../src/core/index.js";
import defaultFactModelYaml from "../../../packs/trials/fact-model.yaml?raw";
import type { Engine, Evaluation, Finding, Flip } from "./api.js";

/* ---------------------------------------------------------------- parsing */

const CACHE_LIMIT = 32;

function memoize<T>(parse: (text: string) => T): (text: string) => T {
  const cache = new Map<string, T>();
  return (text: string): T => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const parsed = parse(text);
    if (cache.size > CACHE_LIMIT) cache.clear();
    cache.set(text, parsed);
    return parsed;
  };
}

/** Parse + memoize; the threshold slider re-evaluates the cohort per tick. */
export const ruleSetOf = memoize<RuleSet>(parseRuleSet);
const factModelOf = memoize<FactModel>(parseFactModel);
const defaultFactModel = factModelOf(defaultFactModelYaml);
const modelByRuleSet = new Map<string, FactModel>();
const blockedRuleSets = new Set<string>();

function rememberModel(rulesetYaml: string, fm: FactModel): void {
  if (modelByRuleSet.size >= CACHE_LIMIT && !modelByRuleSet.has(rulesetYaml)) modelByRuleSet.clear();
  modelByRuleSet.set(rulesetYaml, fm);
  blockedRuleSets.delete(rulesetYaml);
}

function modelFor(...rulesetYamls: string[]): FactModel {
  if (rulesetYamls.some((yaml) => blockedRuleSets.has(yaml))) {
    throw new Error("evaluation blocked: fact-model-schema: the associated fact model is invalid");
  }
  return rulesetYamls.map((yaml) => modelByRuleSet.get(yaml)).find((fm) => fm !== undefined) ?? defaultFactModel;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/* --------------------------------------------------------------- findings */

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * Severity order for the panel and the editor's marker list. Core emits lint
 * findings in criterion order and appends conflicts, which puts the blocking
 * error last; ordering is presentation, so it happens here rather than in core.
 */
const bySeverity = (findings: Finding[]): Finding[] =>
  [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

/* ----------------------------------------------------------------- engine */

export const realEngine: Engine = {
  evalPatient(rulesetYaml: string, patient: PatientFacts): Evaluation {
    return coreEvalPatient(ruleSetOf(rulesetYaml), modelFor(rulesetYaml), patient);
  },

  check(rulesetYaml: string, factModelYaml: string): Finding[] {
    let rs: RuleSet;
    try {
      rs = ruleSetOf(rulesetYaml);
    } catch (err) {
      // Nothing else can run: every pass needs a parsed rule set.
      return [{ level: "error", code: "schema", message: message(err), criteria: [] }];
    }
    try {
      const fm = factModelOf(factModelYaml);
      rememberModel(rulesetYaml, fm);
      return bySeverity(checkRuleSet(rs, fm));
    } catch (err) {
      // Still report rule-only conflicts, but fail closed: without a parsed
      // fact model neither rule/model checks nor patient evaluation are safe.
      modelByRuleSet.delete(rulesetYaml);
      if (blockedRuleSets.size >= CACHE_LIMIT && !blockedRuleSets.has(rulesetYaml)) blockedRuleSets.clear();
      blockedRuleSets.add(rulesetYaml);
      return bySeverity([
        {
          level: "error",
          code: "fact-model-schema",
          message: `${message(err)} — evaluation is blocked because fact-model checks cannot run.`,
          criteria: [],
        },
        ...detectConflicts(rs),
      ]);
    }
  },

  behavioralDiff(aYaml: string, bYaml: string, corpus: PatientFacts[]): Flip[] {
    const a = ruleSetOf(aYaml);
    const b = ruleSetOf(bYaml);
    const fm = modelFor(bYaml, aYaml);
    // Validate the contracts even for an empty corpus, then validate each
    // patient before delegating to the deterministic diff primitive.
    coreEvalPatient(a, fm, { patient: "__contract_validation__", facts: {} });
    coreEvalPatient(b, fm, { patient: "__contract_validation__", facts: {} });
    for (const patient of corpus) {
      coreEvalPatient(a, fm, patient);
      coreEvalPatient(b, fm, patient);
    }
    return coreBehavioralDiff(a, b, corpus);
  },
};
