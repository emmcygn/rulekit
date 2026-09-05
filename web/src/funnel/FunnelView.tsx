import { useState } from "react";
import type { PatientFacts, RuleSet } from "../../../src/core/schema.js";
import type { Evaluation } from "../engine/api.js";
import { demographics, DEMO_TRIAL } from "../data/index.js";
import type { Funnel, FunnelRow } from "./compute.js";
import { BAND_LABEL, BAND_MARK, DISPLAY_BANDS, displayBandOf } from "./bands.js";
import { markFor, resultProse } from "./trace.js";

type Props = {
  funnel: Funnel;
  evaluations: Evaluation[];
  cohort: PatientFacts[];
  ruleSet: RuleSet;
  selected: string | null;
  onSelect: (patient: string | null) => void;
  /** "as of N of M facts reviewed" — every count here moves with review state. */
  asOf: string;
};

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

/** The one status vocabulary, shared by the bar legend, the totals and the marks. */
const LEGEND: { mark: string; label: string }[] = [
  { mark: "elig", label: "passes" },
  { mark: "ne", label: "not evaluable" },
  { mark: "cr", label: "pending chart review" },
  { mark: "fail", label: "screen fail" },
];

export function FunnelView({
  funnel,
  evaluations,
  cohort,
  ruleSet,
  selected,
  onSelect,
  asOf,
}: Props) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const verbatimOf = (id: string) => ruleSet.criteria.find((c) => c.id === id)?.verbatim ?? "";
  const demographicsOf = (id: string) => {
    const p = cohort.find((c) => c.patient === id);
    return p ? demographics(p) : "";
  };
  const selectedEval = evaluations.find((e) => e.patient === selected) ?? null;
  const selectedBand = selectedEval ? displayBandOf(selectedEval) : null;
  const eligible = funnel.bands["potentially-eligible"];
  const unmodeledCount = funnel.rows.filter((row) => row.unmodeled).length;

  return (
    <div className="view">
      <div className="vhead">
        <h2>Screening funnel</h2>
        <span className="sub">
          cohort n = {funnel.n} · {DEMO_TRIAL.cohortNote}
        </span>
        <span className="tok ink3" style={{ marginLeft: "auto" }}>
          {asOf}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div className="fgrid fhead">
          <span />
          <span className="legend">
            {LEGEND.map((l) => (
              <span key={l.mark}>
                <span className={`mk mk-${l.mark}`} /> {l.label}
              </span>
            ))}
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
          <span
            className="right-align"
            title="Strict sole reason / sole modeled reason pending chart review. The modeled count ignores only unresolved unmodeled criteria and never means eligible."
          >
            sole reason
            <br />
            strict / modeled
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
        <div className="ink3" style={{ fontSize: 11, paddingTop: 6, textAlign: "right" }}>
          sole modeled reason pending chart review ignores only unresolved unmodeled criteria ·{" "}
          {unmodeledCount} unmodeled criterion{unmodeledCount === 1 ? "" : "s"} still require chart review
          · these patients are not eligible
        </div>
      </div>

      <div className="totals" data-testid="funnel-totals">
        {DISPLAY_BANDS.map((band) => (
          <span key={band}>
            <span className={`mk mk-${BAND_MARK[band]}`} />
            <span className={band === "potentially-eligible" ? undefined : "ink2"}>
              {band === "potentially-eligible" ? (
                <b>
                  {funnel.bands[band]} {BAND_LABEL[band]}
                </b>
              ) : (
                `${funnel.bands[band]} ${BAND_LABEL[band]}`
              )}
            </span>
          </span>
        ))}
        <span className="ink3" style={{ fontSize: 11.5 }}>
          every band is the engine's own verdict on the patient · {asOf}
        </span>
      </div>

      {eligible > 0 ? (
        <div className="note">
          Demo projection · {eligible} potentially eligible → ~40% chart-confirm → ~25% consent. The
          rates are illustrative, not measured. The screen-failure distribution above is what a
          feasibility questionnaire argues with; the cohort is synthetic, so the absolute numbers
          are illustrative too.
        </div>
      ) : (
        <div className="note">
          No patient clears every criterion yet ·{" "}
          {funnel.bands["pending-chart-review"] > 0
            ? `${funnel.bands["pending-chart-review"]} are waiting on a chart review that only a human can settle. Confirm the fact a chart-review criterion reads in the Review tab and they move.`
            : "the projection is suppressed until at least one patient reaches the band."}
        </div>
      )}

      <div className="drill">
        {selectedEval && selectedBand ? (
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
                data-testid="drill-band"
              >
                <span className={`mk mk-${BAND_MARK[selectedBand]}`} />
                {BAND_LABEL[selectedBand]}
              </span>
              <button className="tbtn" onClick={() => onSelect(null)}>
                Clear
              </button>
            </div>
            <div className="trace">
              {selectedEval.results.map((r) => (
                <div className="trace-line" key={r.id}>
                  <span className={`mk mk-${markFor(r)}`} />
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
  const allParked = row.unmodeled && row.chartReview === row.entering;
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
            <div className="bar-pass" style={{ width: `${pct(row.pass, row.entering)}%` }} />
            <div
              className={row.unmodeled ? "bar-cr" : "hatchfill"}
              style={{ width: `${pct(row.unknown, row.entering)}%` }}
            />
            <div className="bar-fail" style={{ width: `${pct(row.fail, row.entering)}%` }} />
          </div>
        </div>
        {allParked ? (
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
            <div
              className="num dim"
              style={{ fontWeight: row.soleReason > 0 || row.soleModeledReason > 0 ? 600 : 400 }}
              title={`${row.soleReason} strict sole reason; ${row.soleModeledReason} sole modeled reason pending chart review — not eligible`}
            >
              {row.soleReason} / {row.soleModeledReason}
            </div>
          </>
        )}
      </button>
      {row.unmodeled && !allParked && (
        <div className="ink2" style={{ fontSize: 11.5, fontStyle: "italic", padding: "0 0 6px" }}>
          chart review · {row.chartReviewResolved} of {row.entering} settled from a confirmed fact ·{" "}
          {row.chartReview} still waiting
        </div>
      )}
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
                  className={`mk mk-${bucket === "pass" ? "elig" : bucket === "fail" ? "fail" : row.unmodeled ? "cr" : "ne"}`}
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
