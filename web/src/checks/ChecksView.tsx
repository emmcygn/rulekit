import type { Finding } from "../engine/api.js";
import type { CriterionSpan } from "../engine/lines.js";

type Props = {
  findings: Finding[];
  spans: Map<string, CriterionSpan>;
  rulesetVersion: string;
  onJump: (line: number) => void;
};

const TITLE: Record<string, string> = {
  "contradictory-band": "contradictory band",
  "unit-mismatch": "unit mismatch",
  "unknown-fact": "unknown fact",
  unsatisfiable: "criterion can never fire",
  unmodeled: "unmodeled criterion",
  "non-numeric-value": "non-numeric lab value",
  schema: "schema error",
};

const TOKEN: Record<Finding["level"], string> = {
  error: "✕ conflict",
  warning: "! warning",
  info: "info",
};

export function ChecksView({ findings, spans, rulesetVersion, onJump }: Props) {
  const blocking = findings.filter((f) => f.level === "error").length;

  return (
    <div className="view" style={{ gap: 0 }}>
      <div className="vhead" style={{ paddingBottom: 14 }}>
        <h2>Checks</h2>
        <span className="sub">
          static analysis of ruleset v{rulesetVersion} · runs on every edit · gates CI via{" "}
          <span className="mono">rules check</span>
        </span>
      </div>

      {findings.length === 0 && (
        <div className="note">No findings. The rule set is schema-clean and free of overlaps.</div>
      )}

      {findings.map((f, i) => {
        const lines = f.criteria
          .map((id) => spans.get(id)?.whenLine)
          .filter((n): n is number => n !== undefined);
        // Cohort findings point at data, not at a line of the rule set.
        const jumpTo = f.code === "non-numeric-value" ? undefined : lines[0];
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
                  {f.code === "non-numeric-value" ? "cohort" : "ruleset.yaml"}
                </span>
              )}
            </div>
            <div
              className="finding-body"
              style={{ color: f.level === "info" ? "var(--ink-2)" : "var(--ink)" }}
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
