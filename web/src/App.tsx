import { useEffect, useMemo, useRef, useState } from "react";
import { parseRuleSet, type PatientFacts, type RuleSet } from "../../src/core/schema.js";
import { RuleEditor, type RevealRequest } from "./editor/RuleEditor.js";
import { realEngine } from "./engine/real.js";
import { resolveChartReview } from "./engine/chart-review.js";
import type { Engine, Evaluation, Finding } from "./engine/api.js";
import { useCheck } from "./engine/useCheck.js";
import { criterionSpans } from "./engine/lines.js";
import { computeFunnel } from "./funnel/compute.js";
import { FunnelView } from "./funnel/FunnelView.js";
import { ThresholdsView } from "./sensitivity/ThresholdsView.js";
import { AmendmentView } from "./amendment/AmendmentView.js";
import { ChecksView } from "./checks/ChecksView.js";
import { cohortFindings } from "./checks/cohort.js";
import { ReviewView } from "./review/ReviewView.js";
import { downloadText } from "./util/io.js";
import {
  applyReview,
  asOfLabel,
  buildCards,
  decide,
  decisionsYaml,
  factsRead,
  loadReviewState,
  reviewProgress,
  saveReviewState,
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

/**
 * The engine every view is handed.
 *
 * `realEngine` is core, untouched. This wrapper adds exactly one pass on top:
 * provenance annotation when an engine input came through human chart review
 * (see `./engine/chart-review.ts`).
 * Every view uses this one object, so a patient cannot be resolved on one tab
 * and unresolved on the next.
 */
const workbenchEngine: Engine = {
  ...realEngine,
  evalPatient(rulesetYaml: string, patient: PatientFacts): Evaluation {
    return resolveChartReview(realEngine.evalPatient(rulesetYaml, patient), patient);
  },
};

const storage = (): Storage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

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
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const findings = useCheck(rulesetYaml, factModelYaml);

  // While the author is editing, the document may be malformed or fail a hard
  // engine check. Views keep showing the last rule set safe to evaluate.
  const parsed = useMemo(() => {
    try {
      const rs = parseRuleSet(rulesetYaml);
      if (realEngine.check(rulesetYaml, factModelYaml).some((f) => f.level === "error")) return null;
      return { rs, yaml: rulesetYaml };
    } catch {
      return null;
    }
  }, [rulesetYaml, factModelYaml]);
  const [good, setGood] = useState<{ rs: RuleSet; yaml: string }>(() => ({
    rs: parseRuleSet(DEMO_RULESET_CURRENT),
    yaml: DEMO_RULESET_CURRENT,
  }));
  useEffect(() => {
    if (parsed) setGood(parsed);
  }, [parsed]);
  const stale = parsed === null;

  // Review decisions are session state that survives a reload, and the cohort
  // the engine sees is a function of them: a proposed fact is withheld until a
  // human confirms it, so every view downstream re-evaluates when a card moves.
  const [review, setReview] = useState(() => loadReviewState(storage()));
  // Phone layout only: the editor collapses behind a toggle bar (the button is
  // display:none on desktop, where both panes are always visible).
  const [editorOpen, setEditorOpen] = useState(false);
  useEffect(() => {
    saveReviewState(storage(), review);
  }, [review]);
  const cohort = useMemo(() => applyReview(DEMO_COHORT, DEMO_FACTS, review), [review]);

  const evaluations = useMemo(
    () => cohort.map((p) => workbenchEngine.evalPatient(good.yaml, p)),
    [good.yaml, cohort],
  );
  const funnel = useMemo(() => computeFunnel(evaluations), [evaluations]);
  const spans = useMemo(() => criterionSpans(good.yaml), [good.yaml]);

  const read = useMemo(() => factsRead(good.yaml), [good.yaml]);
  const progress = useMemo(() => reviewProgress(DEMO_FACTS, review, read), [review, read]);
  const asOf = asOfLabel(progress);

  // Findings for the last valid document are retained while the current edit is
  // invalid, so downstream panels and their diagnostics describe the same rules.
  const cohortOnly = useMemo(() => cohortFindings(good.rs, cohort), [good.rs, cohort]);
  const [lastGood, setLastGood] = useState<Finding[]>(() => []);
  useEffect(() => {
    if (!stale && !findings.some((f) => f.level === "error")) setLastGood(findings);
  }, [findings, stale]);
  const allFindings: Finding[] = useMemo(() => {
    if (!stale) return [...findings, ...cohortOnly];
    const liveErrors = findings.filter((f) => f.level === "error");
    return [
      ...liveErrors,
      ...lastGood.map((f) => ({ ...f, message: `${f.message} (last valid version)` })),
      ...cohortOnly.map((f) => ({ ...f, message: `${f.message} (last valid version)` })),
    ];
  }, [findings, cohortOnly, lastGood, stale]);

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
        engine: workbenchEngine,
        state: review,
      }),
    [good.yaml, review],
  );
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
      <a
        className="skiplink"
        href="#results"
        onClick={(e) => {
          e.preventDefault();
          resultsRef.current?.focus();
        }}
      >
        Skip to results
      </a>

      <header className="topbar" role="banner">
        <h1 className="logo">
          <i />
          rulekit
        </h1>
        <div className="psel">
          <span className="pid">{DEMO_TRIAL.id}</span>
          <span className="ink2">{DEMO_TRIAL.title}</span>
        </div>
        <div className="pill">{DEMO_TRIAL.protocolPill}</div>
        <div className="pill">ruleset v{good.rs.rulesetVersion}</div>
        <div className="tspacer" />
        <span className="ink3" style={{ fontSize: 11.5 }}>
          Edit the rules on the left; every panel on the right re-evaluates the {funnel.n}-patient
          synthetic cohort as you type.
        </span>
      </header>

      <div className={`body${editorOpen ? " editor-open" : ""}`}>
        <button
          className="editor-toggle"
          aria-expanded={editorOpen}
          aria-controls="rule-editor"
          onClick={() => setEditorOpen((v) => !v)}
        >
          {editorOpen ? "Hide the rule editor" : "Edit rules"}
        </button>
        <div className="editor" id="rule-editor" role="region" aria-label="Rule editor">
          <div className="etabs" role="tablist" aria-label="Documents">
            {(
              [
                ["ruleset", "ruleset.yaml"],
                ["tests", "tests.yaml"],
                ["factModel", "patient-facts/v1"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={doc === id}
                className={`etab${doc === id ? " on" : ""}`}
                onClick={() => setDoc(id)}
              >
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

        <main
          className="right"
          id="results"
          ref={resultsRef}
          tabIndex={-1}
          role="main"
          aria-label="Results"
        >
          <div className="tabs" role="tablist" aria-label="Results views">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? " on" : ""}`}
                onClick={() => {
                  setTab(t.id);
                  window.history.replaceState(null, "", `#${t.id}`);
                }}
              >
                {t.label}
                {t.id === "checks" && problems > 0 && <span className="ct">{problems}</span>}
                {t.id === "review" && progress.pending > 0 && (
                  <span className="ct">{progress.pending}</span>
                )}
              </button>
            ))}
          </div>

          {stale && (
            <div className="stale-banner" role="status" data-testid="stale-banner">
              <b>The editor's rule set is not valid.</b> Every panel on this tab — counts,
              distributions and diffs alike — is showing the <i>last valid version</i>, not what is
              in the editor.{" "}
              <button className="linkbtn" onClick={() => setTab("checks")}>
                See the blocking error in Checks
              </button>
            </div>
          )}

          <div className={`pane${stale ? " stale" : ""}`}>
            {tab === "funnel" && (
              <FunnelView
                funnel={funnel}
                evaluations={evaluations}
                cohort={cohort}
                ruleSet={good.rs}
                selected={selected}
                onSelect={setSelected}
                asOf={asOf}
              />
            )}
            {tab === "thresholds" && (
              <ThresholdsView
                rulesetYaml={good.yaml}
                cohort={cohort}
                engine={workbenchEngine}
                onCopyBack={setRulesetYaml}
                asOf={asOf}
              />
            )}
            {tab === "amendment" && (
              <AmendmentView
                rulesetYaml={good.yaml}
                priorYaml={DEMO_RULESET_PRIOR}
                cohort={cohort}
                enrolled={DEMO_ENROLLED}
                engine={workbenchEngine}
                asOf={asOf}
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
                stale={stale}
                onJump={jumpToLine}
              />
            )}
            {tab === "review" && (
              <ReviewView
                cards={reviewCards}
                bands={funnel.bands}
                progress={progress}
                factModelYaml={factModelYaml}
                onDecide={onDecide}
                onDownload={() =>
                  downloadText(
                    `rulekit-decisions-${new Date().toISOString().slice(0, 10)}.yaml`,
                    decisionsYaml(DEMO_FACTS, review),
                  )
                }
                onReset={() => setReview({})}
              />
            )}
          </div>
        </main>
      </div>

      <div className="disclaimer">
        Demonstration of rule-governance tooling · synthetic protocol and synthetic patients · not
        medical software, and not for clinical, feasibility, or research screening use.
      </div>
    </div>
  );
}
