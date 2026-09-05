import { useMemo, useRef, useState } from "react";
import type { PatientFacts, RuleSet } from "../../../src/core/schema.js";
import type { Engine } from "../engine/api.js";
import { BAND_LABEL, DISPLAY_BANDS, summaryLine } from "../funnel/bands.js";
import { copyText } from "../util/io.js";
import {
  excludes,
  histogram,
  knobValues,
  niceWidth,
  setKnob,
  yieldsAreRanked,
} from "./compute.js";
import { useSensitivity } from "./useSensitivity.js";

type Props = {
  rulesetYaml: string;
  ruleSet: RuleSet;
  cohort: PatientFacts[];
  engine: Engine;
  onCopyBack: (nextYaml: string) => void;
  /** "as of N of M facts reviewed" — the review state these numbers stand on. */
  asOf: string;
};

export function ThresholdsView({ rulesetYaml, ruleSet, cohort, engine, onCopyBack, asOf }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const histRef = useRef<HTMLDivElement | null>(null);

  const sensitivity = useSensitivity(
    rulesetYaml,
    ruleSet,
    cohort,
    engine,
    pickedId,
    preview,
  );
  const { targets, target, ranked } = sensitivity;
  const ordered = yieldsAreRanked(ranked);
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

  const before = sensitivity.before;
  const after = sensitivity.after;

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
  const clamp = (v: number) => Math.min(hi, Math.max(lo, Math.round(v)));
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

  const unit = target.knob === "windowDays" ? "days" : (target.unit ?? "");
  const fmt = (v: number) => (target.knob === "windowDays" ? `${v}d` : String(v));
  const dirty = preview !== null && preview !== saved;
  const countedIn = values.numeric.filter((v) => !excludes(target, current, v.value)).length;
  const withoutValue = cohort.length - values.numeric.length;

  const summary = (): string =>
    [
      `Threshold impact — ${target.ref ?? ""} ${target.criterionId} (${target.label})`,
      `cohort n = ${cohort.length} · ${asOf}`,
      "",
      `saved ${fmt(saved)}${dirty ? ` · preview ${fmt(current)}` : ""}`,
      `${countedIn} of ${values.numeric.length} recorded values stay in the pool` +
        (withoutValue > 0 ? ` · ${withoutValue} of ${cohort.length} have no ${target.fact} value` : ""),
      "",
      `before: ${before ? summaryLine(before) : "calculating"}`,
      `after:  ${after ? summaryLine(after) : "calculating"}`,
      "",
      "Yield if relaxed by one step (patients returned from screen fail):",
      ...ranked.map(
        (y) =>
          `  ${y.ref ?? ""} ${y.criterionId}  ${y.from} → ${y.to}  ${y.delta >= 0 ? "+" : ""}${y.delta}`,
      ),
      "",
      "Exploratory preview — ruleset.yaml is unchanged. Synthetic protocol and synthetic patients.",
    ].join("\n");

  return (
    <div className="view">
      <div className="vhead">
        <h2>Threshold impact</h2>
        <span className="sub">drag the threshold or type it · cohort re-evaluates live</span>
        <button
          className="tbtn"
          style={{ marginLeft: "auto" }}
          disabled={sensitivity.pending}
          onClick={() => {
            void copyText(summary()).then((ok) => {
              setCopied(ok);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied" : "Copy summary"}
        </button>
      </div>

      {sensitivity.error && (
        <div className="f-error" role="alert">
          Sensitivity analysis stopped: {sensitivity.error}
        </div>
      )}

      <div className="knobbar">
        <span className="refbadge" style={{ fontSize: 13 }}>
          {target.ref ?? ""}
        </span>
        <select
          className="select"
          aria-label="criterion to tune"
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
              <span className="preview">{fmt(current)}</span>
            </>
          )}
        </span>
        <label className="numbox">
          <span className="ink2">set to</span>
          <input
            type="number"
            className="numbox__input"
            aria-label={`${target.criterionId} threshold value`}
            value={current}
            min={lo}
            max={hi}
            step={1}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setPreview(clamp(n));
            }}
          />
          {unit && <span className="ink3">{unit}</span>}
        </label>
      </div>

      <div className="chart">
        <div className="chart-note">
          cohort {target.knob === "windowDays" ? "recency" : target.fact} distribution · n ={" "}
          {values.numeric.length} of {cohort.length}
          {withoutValue > 0 && ` · ${withoutValue} without a recorded ${target.fact} value`}
          {values.unusable.length > 0 && ` · ${values.unusable.length} not evaluable, excluded`} ·{" "}
          {width}-unit buckets, {lo}–{hi}
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
          aria-valuetext={`${current}${unit ? ` ${unit}` : ""}`}
          tabIndex={0}
          onKeyDown={(e) => {
            const step = e.key === "PageUp" || e.key === "PageDown" ? 5 : 1;
            if (e.key === "ArrowLeft" || e.key === "PageDown") setPreview(clamp(current - step));
            else if (e.key === "ArrowRight" || e.key === "PageUp") setPreview(clamp(current + step));
            else if (e.key === "Home") setPreview(lo);
            else if (e.key === "End") setPreview(hi);
            else return;
            e.preventDefault();
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
                  className={`hist-bar ${cls}${b.count === 0 ? " empty" : ""}`}
                  style={{ height: `${(b.count / maxCount) * 100}%` }}
                  title={`${b.lo}–${b.hi}: ${b.count}`}
                >
                  {b.count > 0 && <span className="hist-count">{b.count}</span>}
                </div>
              );
            })}
          </div>
          <div className="thline" style={{ left: `${xOf(saved)}%` }} />
          <div className="thlabel" style={{ left: `calc(${xOf(saved)}% + 5px)` }}>
            saved {fmt(saved)}
          </div>
          {dirty && (
            <>
              <div className="thline preview" style={{ left: `${xOf(current)}%` }} />
              <div className="thlabel preview" style={{ left: `calc(${xOf(current)}% + 5px)`, top: 12 }}>
                preview {fmt(current)}
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
          {countedIn} of {values.numeric.length} recorded values stay in the pool
        </div>
      </div>

      <div className="recount" data-testid="recount" aria-live="polite">
        {before && after ? (
          DISPLAY_BANDS.map((band, i) => (
            <span key={band}>
              {i > 0 && <>&nbsp;&nbsp;·&nbsp;&nbsp;</>}
              {BAND_LABEL[band]} {before[band]} <span className="ink3">→</span>{" "}
              <b
                className={
                  (band === "potentially-eligible" || band === "pending-chart-review") &&
                  after[band] > before[band]
                    ? "up"
                    : ""
                }
              >
                {after[band]}
              </b>
            </span>
          ))
        ) : (
          <span className="ink2">calculating cohort impact…</span>
        )}
      </div>
      <div className="ink3" style={{ fontSize: 11.5, marginTop: -8 }}>
        band counts are the engine's verdict per patient · {asOf}
        {countedIn !== values.numeric.length &&
          after !== undefined &&
          before !== undefined &&
          after["potentially-eligible"] === before["potentially-eligible"] &&
          " · a value re-entering the pool does not move a band when another criterion still blocks that patient"}
      </div>

      <div>
        <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 6 }}>
          yield if relaxed by one step · patients returned from screen fail · every numeric knob,{" "}
          {ordered ? "ranked" : "unranked (the top yields tie)"}
        </div>
        <div className="yield-list" data-testid="yield-list">
          {sensitivity.pending && <span className="ink2">calculating yields…</span>}
          {!sensitivity.pending && ranked.length === 0 && (
            <span className="ink2">this rule set has no numeric knob</span>
          )}
          {ranked.map((y, i) => (
            <div key={`${y.criterionId}-${y.from}`}>
              <button
                onClick={() => {
                  setPickedId(`${y.target.criterionId}.${y.target.knob}`);
                  setPreview(y.to);
                }}
              >
                {ordered ? `${i + 1}  ` : "·  "}
                {y.ref ?? ""} {y.criterionId}&nbsp;&nbsp;{y.from} → {y.to}
                &nbsp;&nbsp;
                <b>
                  {y.delta >= 0 ? "+" : ""}
                  {y.delta}
                </b>
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
