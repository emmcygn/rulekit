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
    return coreEvalPatient(ruleSetOf(rulesetYaml), patient);
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
      return bySeverity(checkRuleSet(rs, factModelOf(factModelYaml)));
    } catch (err) {
      // The fact model is a separate document in a separate editor tab. Losing
      // it costs the lint pass, not the conflict pass — so still report the
      // conflicts, and say why the fact-model findings are missing.
      return bySeverity([
        {
          level: "warning",
          code: "fact-model-schema",
          message: `${message(err)} — fact-model checks (unknown facts, types, units, code systems) are not running.`,
          criteria: [],
        },
        ...detectConflicts(rs),
      ]);
    }
  },

  behavioralDiff(aYaml: string, bYaml: string, corpus: PatientFacts[]): Flip[] {
    return coreBehavioralDiff(ruleSetOf(aYaml), ruleSetOf(bYaml), corpus);
  },
};
