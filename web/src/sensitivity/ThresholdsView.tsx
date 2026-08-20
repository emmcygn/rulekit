import { useMemo, useRef, useState } from "react";
import type { PatientFacts } from "../../../src/core/schema.js";
import type { Engine } from "../engine/api.js";
import { cohortCounts } from "../funnel/compute.js";
import {
  excludes,
  histogram,
  knobValues,
  niceWidth,
  numericTargets,
  setKnob,
  topYield,
  type Target,
} from "./compute.js";

type Props = {
  rulesetYaml: string;
  cohort: PatientFacts[];
  engine: Engine;
  onCopyBack: (nextYaml: string) => void;
};

export function ThresholdsView({ rulesetYaml, cohort, engine, onCopyBack }: Props) {
  const targets = useMemo(() => numericTargets(rulesetYaml), [rulesetYaml]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const histRef = useRef<HTMLDivElement | null>(null);

  const ranked = useMemo(() => topYield(rulesetYaml, cohort, engine), [rulesetYaml, cohort, engine]);
  // Open on the knob worth the most patients rather than the first one written.
  const best = ranked[0]?.target;
  const target: Target | undefined =
    targets.find((t) => `${t.criterionId}.${t.knob}` === pickedId) ??
    targets.find((t) => best && t.criterionId === best.criterionId && t.knob === best.knob) ??
    targets[0];
  const saved = target?.value ?? 0;
  const current = preview ?? saved;

  const values = useMemo(
    () => (target ? knobValues(cohort, target) : { numeric: [], unusable: [] }),
    [cohort, target],
  );
  const numbers = values.numeric.map((v) => v.value);
  const width = useMemo(() => niceWidth([...numbers, saved, current]), [numbers, saved, current]);
  const bins = useMemo(
    () => histogram(numbers, width, [saved, current]),
    [numbers, width, saved, current],
  );
  const lo = bins[0]?.lo ?? 0;
  const hi = bins.at(-1)?.hi ?? 1;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  const before = useMemo(
    () => cohortCounts(cohort.map((p) => engine.evalPatient(rulesetYaml, p))),
    [cohort, engine, rulesetYaml],
  );
  const previewYaml = useMemo(
    () => (target && preview !== null ? setKnob(rulesetYaml, target.path, preview) : rulesetYaml),
    [rulesetYaml, target, preview],
  );
  const after = useMemo(
    () => cohortCounts(cohort.map((p) => engine.evalPatient(previewYaml, p))),
    [cohort, engine, previewYaml],
  );

  if (!target) {
    return (
      <div className="view">
        <div className="vhead">
          <h2>Threshold impact</h2>
        </div>
        <div className="note">This rule set has no numeric threshold to drag.</div>
      </div>
    );
  }

  const xOf = (value: number) => ((value - lo) / (hi - lo)) * 100;
  const valueAt = (clientX: number): number => {
    const rect = histRef.current?.getBoundingClientRect();
    if (!rect) return current;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(lo + ratio * (hi - lo));
  };
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0 && e.type !== "pointerdown") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPreview(valueAt(e.clientX));
  };

  const delta = (a: number, b: number) => (b === a ? null : b > a ? "up" : "down");
  const dirty = preview !== null && preview !== saved;
  const countedIn = values.numeric.filter((v) => !excludes(target, current, v.value)).length;

  return (
    <div className="view">
      <div className="vhead">
        <h2>Threshold impact</h2>
        <span className="sub">drag the threshold on the chart · cohort re-evaluates live</span>
      </div>

      <div className="knobbar">
        <span className="refbadge" style={{ fontSize: 13 }}>
          {target.ref ?? ""}
        </span>
        <select
          className="select"
          value={`${target.criterionId}.${target.knob}`}
          onChange={(e) => {
            setPickedId(e.target.value);
            setPreview(null);
          }}
        >
          {targets.map((t) => (
            <option key={`${t.criterionId}.${t.knob}`} value={`${t.criterionId}.${t.knob}`}>
              {t.ref ? `${t.ref} ` : ""}
              {t.criterionId} — {t.label}
            </option>
          ))}
        </select>
        <span className="knob-value">
          {target.label}
          {dirty && (
            <>
              {" "}
              <span className="arrow">→</span>{" "}
              <span className="preview">
                {target.knob === "windowDays" ? `${preview}d` : preview}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="chart">
        <div className="chart-note">
          cohort {target.knob === "windowDays" ? "recency" : target.fact} distribution · n ={" "}
          {values.numeric.length} · {width}-unit buckets, {lo}–{hi}
          {values.unusable.length > 0 && ` · ${values.unusable.length} not evaluable, excluded`}
        </div>
        <div
          className="hist"
          ref={histRef}
          onPointerDown={drag}
          onPointerMove={drag}
          role="slider"
          aria-label={`${target.criterionId} threshold`}
          aria-valuenow={current}
          aria-valuemin={lo}
          aria-valuemax={hi}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPreview(current - 1);
            if (e.key === "ArrowRight") setPreview(current + 1);
          }}
        >
          <div className="hist-bars">
            {bins.map((b) => {
              const mid = (b.lo + b.hi) / 2;
              const wasOut = excludes(target, saved, mid);
              const isOut = excludes(target, current, mid);
              const cls = wasOut === isOut ? (isOut ? "excluded" : "") : "returned";
              return (
                <div
                  key={b.lo}
                  className={`hist-bar ${cls}`}
                  style={{ height: `${(b.count / maxCount) * 100}%` }}
                  title={`${b.lo}–${b.hi}: ${b.count}`}
                />
              );
            })}
          </div>
          <div className="thline" style={{ left: `${xOf(saved)}%` }} />
          <div className="thlabel" style={{ left: `calc(${xOf(saved)}% + 5px)` }}>
            saved {target.knob === "windowDays" ? `${saved}d` : saved}
          </div>
          {dirty && (
            <>
              <div className="thline preview" style={{ left: `${xOf(current)}%` }} />
              <div className="thlabel preview" style={{ left: `calc(${xOf(current)}% + 5px)`, top: 12 }}>
                preview {target.knob === "windowDays" ? `${current}d` : current}
              </div>
            </>
          )}
          <div className="thhandle" style={{ left: `${xOf(current)}%` }} />
        </div>
        <div className="axis">
          <span>{lo}</span>
          <span>{hi}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 6 }}>
          dark bars = removed at the saved threshold · shaded bars change side under the preview ·{" "}
          {countedIn} of {values.numeric.length} values stay in the pool
        </div>
      </div>

      <div className="recount">
        potentially eligible {before.potentiallyEligible} <span className="ink3">→</span>{" "}
        <b className={delta(before.potentiallyEligible, after.potentiallyEligible) === "up" ? "up" : ""}>
          {after.potentiallyEligible}
        </b>
        &nbsp;&nbsp;·&nbsp;&nbsp;screen fail {before.screenFail} <span className="ink3">→</span>{" "}
        {after.screenFail}&nbsp;&nbsp;·&nbsp;&nbsp;not evaluable {before.notEvaluable}{" "}
        <span className="ink3">→</span> {after.notEvaluable}
      </div>

      <div>
        <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 6 }}>
          top criteria by yield if relaxed
        </div>
        <div className="yield-list">
          {ranked.length === 0 && <span className="ink2">no single relaxation returns a patient</span>}
          {ranked.map((y, i) => (
            <div key={`${y.criterionId}-${y.from}`}>
              <button
                onClick={() => {
                  setPickedId(`${y.target.criterionId}.${y.target.knob}`);
                  setPreview(y.to);
                }}
              >
                {i + 1}&nbsp;&nbsp;{y.ref ?? ""} {y.criterionId}&nbsp;&nbsp;{y.from} → {y.to}
                &nbsp;&nbsp;<b>+{y.delta}</b>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="actions">
        <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
          Exploratory preview — <b style={{ color: "var(--ink)" }}>ruleset.yaml is unchanged</b> until
          you copy the threshold back. Sites don't change criteria; this is the argument you attach to
          the feasibility questionnaire.
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flex: "none" }}>
          <button className="tbtn" onClick={() => setPreview(null)} disabled={!dirty}>
            Reset
          </button>
          <button
            className="tbtn"
            disabled={!dirty}
            onClick={() => {
              onCopyBack(setKnob(rulesetYaml, target.path, current));
              setPreview(null);
            }}
          >
            Copy threshold back to YAML
          </button>
        </div>
      </div>
    </div>
  );
}
