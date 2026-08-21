import type { Finding } from "../engine/api.js";
import type { CriterionSpan } from "../engine/lines.js";

type Props = {
  findings: Finding[];
  spans: Map<string, CriterionSpan>;
  rulesetVersion: string;
  /** The editor's document does not parse: name no version, and say what these are. */
  stale?: boolean;
  onJump: (line: number) => void;
};

/**
 * Human titles for the codes the engine emits. The first block is core's own
 * (src/core/lint.ts, src/core/conflicts.ts); the second is the workbench's, for
 * findings core has no place to produce — unparsed editor text, and the two
 * cohort-level findings that need patients rather than a rule set.
 */
const TITLE: Record<string, string> = {
  "unknown-fact": "unknown fact",
  "type-mismatch": "type mismatch",
  "unit-mismatch": "unit mismatch",
  "unknown-code-system": "unknown code system",
  "unmodeled-criterion": "unmodeled criterion",
  "contradictory-band": "contradictory band",
  "unsatisfiable-criterion": "criterion can never fire",

  schema: "rule set does not parse",
  "fact-model-schema": "fact model does not parse",
  "non-numeric-value": "non-numeric lab value",
};

/** Findings about the cohort or an unparsed document point at no rule-set line. */
const NO_LINE = new Set(["non-numeric-value", "schema", "fact-model-schema"]);

const TOKEN: Record<Finding["level"], string> = {
  error: "✕ conflict",
  warning: "! warning",
  info: "info",
};

export function ChecksView({ findings, spans, rulesetVersion, stale = false, onJump }: Props) {
  const blocking = findings.filter((f) => f.level === "error").length;

  return (
    <div className="view" style={{ gap: 0 }}>
      <div className="vhead" style={{ paddingBottom: 14 }}>
        <h2>Checks</h2>
        <span className="sub">
          {stale ? (
            <>
              the editor's document does not parse · the parse error is live, everything under it is
              from the <b>last valid version</b>
            </>
          ) : (
            <>
              static analysis of ruleset v{rulesetVersion} · runs on every edit · gates CI via{" "}
              <span className="mono">rules check</span>
            </>
          )}
        </span>
      </div>

      {findings.length === 0 && (
        <div className="note">
          0 conflicts found. Static analysis covers single-fact interval logic, the fact model and
          the code systems — it does not prove the rule set correct.
        </div>
      )}

      {findings.map((f, i) => {
        const lines = f.criteria
          .map((id) => spans.get(id)?.whenLine)
          .filter((n): n is number => n !== undefined);
        // Cohort findings point at data, not at a line of the rule set.
        const jumpTo = NO_LINE.has(f.code) ? undefined : lines[0];
        return (
          <div key={`${f.code}-${i}`} className={`finding f-${f.level === "error" ? "error" : f.level === "warning" ? "warn" : "info"}`}>
            <div className="finding-head">
              <span
                className="tok"
                style={{ color: f.level === "error" ? "var(--ink)" : f.level === "info" ? "var(--ink-3)" : "var(--ink-2)" }}
              >
                {TOKEN[f.level]}
              </span>
              <span
                className="finding-title"
                style={{ color: f.level === "info" ? "var(--ink-2)" : "var(--ink)" }}
              >
                {TITLE[f.code] ?? f.code}
              </span>
              {jumpTo !== undefined ? (
                <button className="finding-jump" onClick={() => onJump(jumpTo)}>
                  ruleset.yaml:{lines.join(", ")}
                </button>
              ) : (
                <span className="finding-jump ink3">
                  {f.code === "non-numeric-value"
                    ? "cohort"
                    : f.code === "fact-model-schema"
                      ? "patient-facts/v1"
                      : "ruleset.yaml"}
                </span>
              )}
            </div>
            <div
              className="finding-body"
              style={{
                color: f.level === "info" ? "var(--ink-2)" : "var(--ink)",
                // A parser dump carries its own line breaks and caret; collapsing
                // them leaves the ^^ pointing at nothing (uiux M8).
                ...(f.code === "schema" || f.code === "fact-model-schema"
                  ? { whiteSpace: "pre-wrap", fontFamily: "var(--mono)", fontSize: 12 }
                  : {}),
              }}
            >
              {f.message}
            </div>
            {f.evidence && <div className="evidence" style={{ marginTop: 8 }}>{f.evidence}</div>}
          </div>
        );
      })}

      <div className="footer-note">
        {blocking === 0
          ? "nothing blocks release"
          : `${blocking} conflict${blocking === 1 ? "" : "s"} block${blocking === 1 ? "s" : ""} release`}{" "}
        · warnings and info do not · the same analyses run in CI on every rule PR
      </div>
    </div>
  );
}
