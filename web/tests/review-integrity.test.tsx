// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { PatientFacts } from "../../src/core/schema.js";
import type { FactsFile } from "../../src/extract/schema.js";
import { realEngine } from "../src/engine/real.js";
import { ReviewQueue } from "../src/review/ReviewQueue.js";
import {
  applyReview,
  checkCardEdit,
  decide,
  decisionsYaml,
  type ReviewState,
} from "../src/review/store.js";
import type { ProposedFactCard } from "../src/review/types.js";

afterEach(cleanup);

const RULESET = `
ruleset: boolean-review-flow
protocol: synthetic
status: draft
rulesetVersion: 1.0.0
factModel: patient-facts/v1
criteria:
  - id: anticoagulant-exclusion
    kind: exclusion
    verbatim: "Current anticoagulant use"
    when: { fact: on_anticoagulant, op: eq, value: true }
`;

const file: FactsFile = {
  patient: "SYN-BOOL",
  facts: [
    {
      fact: "on_anticoagulant",
      value: true,
      status: "proposed",
      confidence: 0.8,
      extractedBy: "llm/test-model",
      source: { doc: "clinic-note", quote: "taking apixaban" },
      reviewedBy: null,
    },
  ],
};
const cohort: PatientFacts[] = [{ patient: "SYN-BOOL", facts: {} }];
const card: ProposedFactCard = {
  id: "SYN-BOOL:on_anticoagulant",
  patient: "SYN-BOOL",
  fact: "on_anticoagulant",
  value: true,
  confidence: 0.8,
  doc: "clinic-note",
  quote: "taking apixaban",
  noteContext: "Medication reconciliation: taking apixaban.",
  flipsVerdict: true,
};

function BooleanReviewFlow() {
  const [state, setState] = useState<ReviewState>({});
  const [exported, setExported] = useState("");
  const patient = applyReview(cohort, [file], state)[0]!;
  const evaluation = realEngine.evalPatient(RULESET, patient);

  return (
    <>
      <output data-testid="evaluation">
        {evaluation.overall}:{String(patient.facts.on_anticoagulant)}:{typeof patient.facts.on_anticoagulant}
      </output>
      <ReviewQueue
        items={state[card.id] ? [] : [card]}
        validate={(_item, draft) => {
          const result = checkCardEdit(card, draft);
          if (!result.ok || Array.isArray(result.value)) return result.ok ? { ok: false, message: "unsupported" } : result;
          return { ok: true, value: result.value };
        }}
        onConfirm={() => setState((current) => decide(current, card.id, "confirmed"))}
        onReject={() => setState((current) => decide(current, card.id, "rejected"))}
        onEdit={(_item, correction) =>
          setState((current) =>
            decide(current, card.id, "confirmed", correction.value, "2026-09-05T09:00:00Z", {
              reason: correction.reason,
              source: correction.source,
            }),
          )
        }
      />
      <button onClick={() => setExported(decisionsYaml([file], state, { reviewer: "Ada Reviewer", cohort }))}>
        Export
      </button>
      <pre data-testid="export">{exported}</pre>
    </>
  );
}

describe("review integrity integration", () => {
  it("keeps a boolean correction typed through UI validation, evaluation, and export", () => {
    render(<BooleanReviewFlow />);
    expect(screen.getByTestId("evaluation").textContent).toBe("undetermined:undefined:undefined");

    fireEvent.click(screen.getByRole("button", { name: "edit on_anticoagulant for SYN-BOOL" }));
    fireEvent.change(screen.getByLabelText("corrected value for on_anticoagulant"), {
      target: { value: "false" },
    });
    fireEvent.change(screen.getByLabelText("correction reason for on_anticoagulant"), {
      target: { value: "Medication list was stale" },
    });
    fireEvent.change(screen.getByLabelText("correction source for on_anticoagulant"), {
      target: { value: "Current medication reconciliation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("evaluation").textContent).toBe("eligible:false:boolean");
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const manifest = parse(screen.getByTestId("export").textContent ?? "") as {
      patients: Array<{ decisions: Array<{ after: { value: unknown; source: Record<string, unknown> } }> }>;
    };
    const after = manifest.patients[0]!.decisions[0]!.after;
    expect(after.value).toBe(false);
    expect(typeof after.value).toBe("boolean");
    expect(after.source).toEqual({
      type: "reviewer-attestation",
      detail: "Current medication reconciliation",
    });
    expect(after.source).not.toHaveProperty("quote");
  });
});
