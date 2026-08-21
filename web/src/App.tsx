import { useEffect, useMemo, useState } from "react";
import { parseRuleSet, type RuleSet } from "../../src/core/schema.js";
import { RuleEditor, type RevealRequest } from "./editor/RuleEditor.js";
import { realEngine } from "./engine/real.js";
import { useCheck } from "./engine/useCheck.js";
import { criterionSpans } from "./engine/lines.js";
import { computeFunnel } from "./funnel/compute.js";
import { FunnelView } from "./funnel/FunnelView.js";
import { ThresholdsView } from "./sensitivity/ThresholdsView.js";
import { AmendmentView } from "./amendment/AmendmentView.js";
import { ChecksView } from "./checks/ChecksView.js";
import { cohortFindings } from "./checks/cohort.js";
import { ReviewView } from "./review/ReviewView.js";
import {
  applyReview,
  buildCards,
  decide,
  initialReviewState,
  pendingCount,
  type Decision,
} from "./review/store.js";
import {
  DEMO_COHORT,
  DEMO_ENROLLED,
  DEMO_FACT_MODEL,
  DEMO_FACTS,
  DEMO_NOTES,
  DEMO_RULESET_CURRENT,
  DEMO_RULESET_PRIOR,
  DEMO_TESTS,
  DEMO_TRIAL,
} from "./data/index.js";

type Tab = "funnel" | "thresholds" | "amendment" | "checks" | "review";
type Doc = "ruleset" | "tests" | "factModel";

const TABS: { id: Tab; label: string }[] = [
  { id: "funnel", label: "Screening funnel" },
  { id: "thresholds", label: "Thresholds" },
  { id: "amendment", label: "Amendment" },
  { id: "checks", label: "Checks" },
  { id: "review", label: "Review" },
];

export function App() {
  const [rulesetYaml, setRulesetYaml] = useState(DEMO_RULESET_CURRENT);
  const [factModelYaml, setFactModelYaml] = useState(DEMO_FACT_MODEL);
  const [testsYaml, setTestsYaml] = useState(DEMO_TESTS);
  const [doc, setDoc] = useState<Doc>("ruleset");
  // The hash picks the opening tab, so a demo or a screenshot can deep-link one.
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = window.location.hash.replace("#", "");
    return TABS.some((t) => t.id === wanted) ? (wanted as Tab) : "funnel";
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);

  const findings = useCheck(rulesetYaml, factModelYaml);

  // While the author is mid-keystroke the document may not parse. The views keep
  // showing the last rule set that did, flagged, rather than blanking out.
  const parsed = useMemo(() => {
    try {
      return { rs: parseRuleSet(rulesetYaml), yaml: rulesetYaml };
    } catch {
      return null;
    }
  }, [rulesetYaml]);
  const [good, setGood] = useState<{ rs: RuleSet; yaml: string }>(() => ({
    rs: parseRuleSet(DEMO_RULESET_CURRENT),
    yaml: DEMO_RULESET_CURRENT,
  }));
  useEffect(() => {
    if (parsed) setGood(parsed);
  }, [parsed]);

  // Review decisions are session state, and the cohort the engine sees is a
  // function of them: a proposed fact is withheld until a human confirms it, so
  // every view downstream of `cohort` re-evaluates when a card is decided.
  const [review, setReview] = useState(() => initialReviewState(DEMO_FACTS));
  const cohort = useMemo(() => applyReview(DEMO_COHORT, DEMO_FACTS, review), [review]);

  const evaluations = useMemo(
    () => cohort.map((p) => realEngine.evalPatient(good.yaml, p)),
    [good.yaml, cohort],
  );
  const funnel = useMemo(() => computeFunnel(evaluations), [evaluations]);
  const spans = useMemo(() => criterionSpans(good.yaml), [good.yaml]);
  const allFindings = useMemo(
    () => [...findings, ...cohortFindings(good.rs, cohort)],
    [findings, good.rs, cohort],
  );
  const problems = allFindings.filter((f) => f.level !== "info").length;
  const errors = allFindings.filter((f) => f.level === "error").length;
  const warnings = allFindings.filter((f) => f.level === "warning").length;
  const reviewCards = useMemo(
    () =>
      buildCards({
        cohort: DEMO_COHORT,
        files: DEMO_FACTS,
        notes: DEMO_NOTES,
        rulesetYaml: good.yaml,
        engine: realEngine,
        state: review,
      }),
    [good.yaml, review],
  );
  const pending = pendingCount(DEMO_FACTS, review);
  const decided = pendingCount(DEMO_FACTS, {}) - pending;
  const onDecide = (id: string, decision: Decision, editedValue?: string) =>
    setReview((s) => decide(s, id, decision, editedValue));

  const jumpToLine = (line: number) => {
    setDoc("ruleset");
    setReveal({ line, nonce: Date.now() });
  };

  const docValue = doc === "ruleset" ? rulesetYaml : doc === "tests" ? testsYaml : factModelYaml;
  const setDocValue =
    doc === "ruleset" ? setRulesetYaml : doc === "tests" ? setTestsYaml : setFactModelYaml;

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">
          <i />
          rulekit
        </div>
        <div className="psel">
          <span className="pid">{DEMO_TRIAL.id}</span>
          <span className="ink2">{DEMO_TRIAL.title}</span>
        </div>
        <div className="pill">{DEMO_TRIAL.protocolPill}</div>
        <div className="pill">ruleset v{good.rs.rulesetVersion}</div>
        <div className="tspacer" />
        <button className="tbtn" disabled title="Not in this phase">
          Export feasibility summary (PDF)
        </button>
      </div>

      <div className="body">
        <div className="editor">
          <div className="etabs">
            {(
              [
                ["ruleset", "ruleset.yaml"],
                ["tests", "tests.yaml"],
                ["factModel", "patient-facts/v1"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={`etab${doc === id ? " on" : ""}`} onClick={() => setDoc(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="editor-host">
            <RuleEditor
              key={doc}
              value={docValue}
              onChange={setDocValue}
              findings={doc === "ruleset" ? findings : []}
              reveal={doc === "ruleset" ? reveal : null}
            />
          </div>
          <div className="estatus">
            <span className={errors > 0 ? "es-err" : "es-warn"}>
              <span className="tok">
                {errors > 0 ? `✕ ${errors} conflict${errors === 1 ? "" : "s"}` : "✓ no conflicts"}
              </span>
            </span>
            {warnings > 0 && (
              <span className="es-warn">
                <span className="tok">
                  ! {warnings} warning{warnings === 1 ? "" : "s"}
                </span>
              </span>
            )}
            <span>rule tests: {DEMO_TESTS.match(/^ {2}- name:/gm)?.length ?? 0} cases (CLI)</span>
            <span className="es-right">YAML · {good.rs.factModel}</span>
          </div>
        </div>

        <div className="right">
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab${tab === t.id ? " on" : ""}`}
                onClick={() => {
                  setTab(t.id);
                  window.history.replaceState(null, "", `#${t.id}`);
                }}
              >
                {t.label}
                {t.id === "checks" && problems > 0 && <span className="ct">{problems}</span>}
                {t.id === "review" && pending > 0 && <span className="ct">{pending}</span>}
              </button>
            ))}
          </div>

          {!parsed && (
            <div
              className="note"
              style={{ margin: "10px 22px 0", borderLeft: "2px solid var(--ink)", borderRadius: 0 }}
            >
              The editor's rule set does not parse — showing results for the last valid version.
            </div>
          )}

          {tab === "funnel" && (
            <FunnelView
              funnel={funnel}
              evaluations={evaluations}
              cohort={cohort}
              ruleSet={good.rs}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {tab === "thresholds" && (
            <ThresholdsView
              rulesetYaml={good.yaml}
              cohort={cohort}
              engine={realEngine}
              onCopyBack={setRulesetYaml}
            />
          )}
          {tab === "amendment" && (
            <AmendmentView
              rulesetYaml={good.yaml}
              priorYaml={DEMO_RULESET_PRIOR}
              cohort={cohort}
              enrolled={DEMO_ENROLLED}
              engine={realEngine}
              onInspectPatient={(p) => {
                setSelected(p);
                setTab("funnel");
              }}
            />
          )}
          {tab === "checks" && (
            <ChecksView
              findings={allFindings}
              spans={spans}
              rulesetVersion={good.rs.rulesetVersion}
              onJump={jumpToLine}
            />
          )}
          {tab === "review" && (
            <ReviewView
              cards={reviewCards}
              notEvaluable={funnel.notEvaluable}
              decided={decided}
              onDecide={onDecide}
            />
          )}
        </div>
      </div>

      <div className="disclaimer">
        Demonstration of rule-governance tooling · synthetic protocol and synthetic patients · not
        medical software, and not for clinical, feasibility, or research screening use.
      </div>
    </div>
  );
}
