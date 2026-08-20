import { useMemo } from "react";
import { parseRuleSet, type PatientFacts } from "../../../src/core/schema.js";
import type { Engine } from "../engine/api.js";
import { cohortCounts } from "../funnel/compute.js";
import { demographics, DEMO_TRIAL, type EnrolledParticipant } from "../data/index.js";
import { criterionOrder, enrolledImpact, groupFlips, structuralDiff } from "./compute.js";

type Props = {
  rulesetYaml: string;
  priorYaml: string;
  cohort: PatientFacts[];
  enrolled: EnrolledParticipant[];
  engine: Engine;
  onInspectPatient: (patient: string) => void;
};

export function AmendmentView({
  rulesetYaml,
  priorYaml,
  cohort,
  enrolled,
  engine,
  onInspectPatient,
}: Props) {
  const prior = useMemo(() => parseRuleSet(priorYaml), [priorYaml]);
  const current = useMemo(() => parseRuleSet(rulesetYaml), [rulesetYaml]);
  const changes = useMemo(() => structuralDiff(prior, current), [prior, current]);

  const flips = useMemo(
    () => engine.behavioralDiff(priorYaml, rulesetYaml, cohort),
    [engine, priorYaml, rulesetYaml, cohort],
  );
  const groups = useMemo(() => groupFlips(flips, criterionOrder(current)), [flips, current]);

  const before = useMemo(
    () => cohortCounts(cohort.map((p) => engine.evalPatient(priorYaml, p))),
    [cohort, engine, priorYaml],
  );
  const after = useMemo(
    () => cohortCounts(cohort.map((p) => engine.evalPatient(rulesetYaml, p))),
    [cohort, engine, rulesetYaml],
  );

  const afterEvals = useMemo(
    () => new Map(cohort.map((p) => [p.patient, engine.evalPatient(rulesetYaml, p)])),
    [cohort, engine, rulesetYaml],
  );
  const demographicsOf = (id: string) => {
    const p = cohort.find((c) => c.patient === id);
    return p ? demographics(p) : "";
  };
  const evidenceFor = (patient: string, criterionId: string) =>
    afterEvals.get(patient)?.results.find((r) => r.id === criterionId)?.trace?.detail ?? "";

  const impacted = useMemo(
    () =>
      enrolledImpact(
        enrolled.map((e) => ({
          participant: e.participant,
          site: e.site,
          randomized: e.randomized,
          before: engine.evalPatient(priorYaml, e.patient),
          after: engine.evalPatient(rulesetYaml, e.patient),
        })),
      ),
    [enrolled, engine, priorYaml, rulesetYaml],
  );

  const refOf = (id: string) => current.criteria.find((c) => c.id === id)?.ref ?? "";

  return (
    <div className="view">
      <div className="vhead">
        <h2>Amendment impact</h2>
        <span className="sub">behavioral diff across the cohort · n = {cohort.length}</span>
      </div>

      <div className="versionbar">
        <div className="pill" style={{ fontSize: 12, height: 24 }}>
          {DEMO_TRIAL.amendment.fromLabel}
        </div>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8h10M9.5 4.5L13 8l-3.5 3.5"
            stroke="#6B655C"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div
          className="pill"
          style={{ fontSize: 12, height: 24, color: "var(--ink)", borderColor: "var(--rule)" }}
        >
          {DEMO_TRIAL.amendment.toLabel}
        </div>
        <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{DEMO_TRIAL.amendment.dates}</span>
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-3)" }}>
          ruleset v{prior.rulesetVersion} → v{current.rulesetVersion}
        </span>
      </div>

      <div className="struct">
        {changes.length === 0 && <span className="ink2">no structural change between versions</span>}
        {changes.map((c) => (
          <div key={`${c.kind}-${c.id}`}>
            <b>
              {c.kind === "added" ? "+ added" : c.kind === "removed" ? "− removed" : "~ changed"}
            </b>
            &nbsp;&nbsp;
            {c.kind === "changed" ? null : `${c.criterionKind} `}
            <b>{c.id}</b> [{c.ref ?? "—"}]{" "}
            <span className="ink2">
              {c.kind === "changed" ? c.summary : `— "${c.verbatim}"`}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13 }}>
        In the future screening pool, <b>{flips.length} of {cohort.length}</b> change outcome{" "}
        <span className="ink2">
          (potentially eligible {before.potentiallyEligible} → {after.potentiallyEligible}, screen
          fail {before.screenFail} → {after.screenFail})
        </span>
        .
      </div>

      <div style={{ minHeight: 0 }}>
        {groups.length === 0 && (
          <div className="ink2" style={{ fontSize: 12.5 }}>
            No patient in the cohort changes outcome between these versions.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.criterionId || "unattributed"}>
            <div className="flip-group">
              {g.criterionId
                ? `${refOf(g.criterionId)} ${g.criterionId} — ${g.flips.length} flip${g.flips.length === 1 ? "" : "s"}`
                : `unattributed — ${g.flips.length}`}
            </div>
            {g.flips.map((f) => (
              <button
                key={f.patient}
                className="flip-row"
                onClick={() => onInspectPatient(f.patient)}
              >
                <span className="mono" style={{ fontWeight: 500 }}>
                  {f.patient}
                </span>
                <span className="ink2">{demographicsOf(f.patient)}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {evidenceFor(f.patient, g.criterionId) || `${f.from} → ${f.to}`}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {impacted.length > 0 && (
        <div className="f-error" style={{ paddingTop: 2, paddingBottom: 2, flex: "none" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            Already enrolled — requires PI / IRB review
          </div>
          <div className="mono" style={{ fontSize: 12, lineHeight: "21px", marginTop: 4 }}>
            {impacted.map((p) => (
              <div key={p.participant}>
                {p.participant}{" "}
                <span className="ink2">
                  randomized {p.randomized} · {p.reasons.map((r) => r.detail).join("; ")} — now meets{" "}
                  {p.reasons.map((r) => r.ref ?? r.id).join(", ")}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 4 }}>
            continuation / re-consent decision per protocol §5.4 · {impacted.length} participant
            {impacted.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
