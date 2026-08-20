import { useState } from "react";
import type { PatientFacts, RuleSet } from "../../../src/core/schema.js";
import type { Evaluation } from "../engine/api.js";
import { demographics, DEMO_TRIAL } from "../data/index.js";
import type { Funnel, FunnelRow } from "./compute.js";
import { markFor, resultProse } from "./trace.js";

type Props = {
  funnel: Funnel;
  evaluations: Evaluation[];
  cohort: PatientFacts[];
  ruleSet: RuleSet;
  selected: string | null;
  onSelect: (patient: string | null) => void;
};

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

export function FunnelView({ funnel, evaluations, cohort, ruleSet, selected, onSelect }: Props) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const verbatimOf = (id: string) => ruleSet.criteria.find((c) => c.id === id)?.verbatim ?? "";
  const demographicsOf = (id: string) => {
    const p = cohort.find((c) => c.patient === id);
    return p ? demographics(p) : "";
  };
  const selectedEval = evaluations.find((e) => e.patient === selected) ?? null;

  return (
    <div className="view">
      <div className="vhead">
        <h2>Screening funnel</h2>
        <span className="sub">
          cohort n = {funnel.n} · {DEMO_TRIAL.cohortNote}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div className="fgrid fhead">
          <span />
          <span className="legend">
            <span>
              <i style={{ background: "var(--fill)" }} /> pass
            </span>
            <span>
              <i style={{ background: "var(--ink)" }} /> screen fail
            </span>
            <span>
              <i className="hatchfill" /> not evaluable
            </span>
          </span>
          <span className="right-align">
            removed
            <br />
            (sequential)
          </span>
          <span className="right-align">
            fails alone
            <br />
            (of n={funnel.n})
          </span>
          <span className="right-align">
            sole
            <br />
            reason
          </span>
        </div>

        {funnel.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            n={funnel.n}
            verbatim={verbatimOf(row.id)}
            open={openRow === row.id}
            onToggle={() => setOpenRow(openRow === row.id ? null : row.id)}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="totals">
        <span>
          <span className="mk mk-fail" />
          <span className="ink2">{funnel.screenFail} screen fail</span>
        </span>
        <span>
          <span className="mk mk-ne" />
          <span className="ink2" style={{ fontStyle: "italic" }}>
            {funnel.notEvaluable} not evaluable
          </span>
        </span>
        <span>
          <span className="mk mk-elig" />
          <b>{funnel.remaining} potentially eligible</b>
          <span className="ink2">— pending chart review (E4)</span>
        </span>
      </div>

      <div className="note">
        Demo projection · {funnel.remaining} potentially eligible → ~40% chart-confirm → ~25%
        consent. The screen-failure distribution above is what a feasibility questionnaire argues
        with; the cohort is synthetic, so the absolute numbers are illustrative.
      </div>

      <div className="drill">
        {selectedEval ? (
          <>
            <div className="drill-head">
              <span className="ink3" style={{ fontSize: 11 }}>
                selected
              </span>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {selectedEval.patient}
              </span>
              <span className="ink2" style={{ fontSize: 12 }}>
                {demographicsOf(selectedEval.patient)}
              </span>
              <span
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
              >
                <span
                  className={`mk mk-${
                    selectedEval.overall === "ineligible"
                      ? "fail"
                      : selectedEval.overall === "eligible"
                        ? "elig"
                        : "ne"
                  }`}
                />
                {selectedEval.overall === "ineligible"
                  ? "screen fail"
                  : selectedEval.overall === "eligible"
                    ? "eligible"
                    : "pending chart review"}
              </span>
              <button className="tbtn" onClick={() => onSelect(null)}>
                Clear
              </button>
            </div>
            <div className="trace">
              {selectedEval.results.map((r) => (
                <div className="trace-line" key={r.id}>
                  <span className={`mk mk-${markFor(r.verdict)}`} />
                  <span>
                    {r.ref ? `${r.ref} ` : ""}
                    {r.id} — {resultProse(r)}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="ink2" style={{ fontSize: 12 }}>
            Click a criterion row to list the patients it decides, then a patient to read its trace.
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  row,
  n,
  verbatim,
  open,
  onToggle,
  selected,
  onSelect,
}: {
  row: FunnelRow;
  n: number;
  verbatim: string;
  open: boolean;
  onToggle: () => void;
  selected: string | null;
  onSelect: (p: string) => void;
}) {
  const width = pct(row.entering, n);
  return (
    <>
      <button className={`fgrid frow${open ? " on" : ""}`} onClick={onToggle}>
        <div>
          <span className="refbadge">{row.ref ?? ""}</span>{" "}
          <span className="crit-id">{row.id}</span>
          <div className="crit-verbatim" title={verbatim}>
            {verbatim}
          </div>
        </div>
        <div style={{ width: "100%" }}>
          <div className="bar" style={{ width: `${width}%` }}>
            {row.unmodeled ? (
              <div className="hatchfill" style={{ width: "100%" }} />
            ) : (
              <>
                <div className="bar-pass" style={{ width: `${pct(row.pass, row.entering)}%` }} />
                <div className="hatchfill" style={{ width: `${pct(row.unknown, row.entering)}%` }} />
                <div className="bar-fail" style={{ width: `${pct(row.fail, row.entering)}%` }} />
              </>
            )}
          </div>
        </div>
        {row.unmodeled ? (
          <div
            style={{ gridColumn: "3 / span 3", fontSize: 11.5, fontStyle: "italic" }}
            className="ink2"
          >
            chart review required · applies to all {row.chartReview} remaining
          </div>
        ) : (
          <>
            <div className="num">{row.removedSequential === 0 ? "0" : `−${row.removedSequential}`}</div>
            <div className="num dim">{row.failsAlone}</div>
            <div className="num dim" style={{ fontWeight: row.soleReason > 0 ? 600 : 400 }}>
              {row.soleReason}
            </div>
          </>
        )}
      </button>
      {open && (
        <div className="patient-chips">
          {(["fail", "unknown", "pass"] as const).flatMap((bucket) =>
            row.patients[bucket].map((p) => (
              <button
                key={`${bucket}-${p}`}
                className={`chip${selected === p ? " on" : ""}`}
                onClick={() => onSelect(p)}
              >
                <span
                  className={`mk mk-${bucket === "pass" ? "elig" : bucket === "fail" ? "fail" : "ne"}`}
                />
                {p}
              </button>
            )),
          )}
          {row.entering === 0 && (
            <span className="ink2" style={{ fontSize: 12 }}>
              nobody reaches this criterion — everyone was removed earlier
            </span>
          )}
        </div>
      )}
    </>
  );
}
