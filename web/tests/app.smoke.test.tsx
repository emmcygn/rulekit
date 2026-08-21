// @vitest-environment jsdom
/**
 * Crash guard plus the invariants that must hold *on screen*: one status per
 * patient across tabs, an edit that cannot be silently discarded, and a stale
 * banner that does not lie about which document the numbers came from.
 *
 * Monaco is stubbed — it needs a real browser, and the editor itself is not
 * under test here (its keyboard behaviour is verified in the headless run).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

afterEach(cleanup);

// vitest's jsdom environment does not install `localStorage`, and the review
// pane's persistence is part of what is under test here, so give the window a
// real one. The app reaches for `window.localStorage` and nothing else.
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
      clear: () => memory.clear(),
      key: () => null,
      length: 0,
    },
  });
});

vi.mock("../src/editor/RuleEditor.js", () => ({
  RuleEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { App } from "../src/App.js";

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const editor = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("workbench shell", () => {
  it("opens on the funnel with the demo cohort counted", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Screening funnel" })).toBeDefined();
    expect(screen.getByText(/cohort n = 10/)).toBeDefined();
    const totals = screen.getByTestId("funnel-totals");
    expect(within(totals).getByText(/^7 screen fail$/)).toBeDefined();
    expect(within(totals).getByText(/^3 pending chart review$/)).toBeDefined();
    expect(within(totals).getByText(/^0 potentially eligible$/)).toBeDefined();
  });

  it("has one h1 and a main landmark", () => {
    render(<App />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("main", { name: "Results" })).toBeDefined();
    expect(screen.getByRole("link", { name: /Skip to results/ })).toBeDefined();
  });

  it("gives a patient the same status in the drill-down as in the totals", () => {
    render(<App />);
    // SYN-042 is unknown at the washout and fails the renal exclusion. The old
    // build banded them "not evaluable" in the totals and "screen fail" here.
    fireEvent.click(screen.getByText("renal-safety"));
    fireEvent.click(screen.getByRole("button", { name: /SYN-042/ }));
    expect(screen.getByTestId("drill-band").textContent).toContain("screen fail");
    expect(screen.getByText(/egfr = 41, required < 45, exclusion fired/)).toBeDefined();
  });

  it("renders the thresholds tab with a live re-count and a number input", () => {
    render(<App />);
    fireEvent.click(tab("Thresholds"));
    expect(screen.getByRole("heading", { name: "Threshold impact" })).toBeDefined();
    expect(screen.getByRole("slider")).toBeDefined();
    expect(screen.getByLabelText(/threshold value/)).toBeDefined();
    // Every knob is listed, +0 included, so the criterion you came for is there.
    const list = screen.getByTestId("yield-list");
    expect(within(list).getByText(/egfr-min/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy summary" })).toBeDefined();
  });

  it("renders the amendment tab, and its headline equals its flip list", () => {
    render(<App />);
    fireEvent.click(tab("Amendment"));
    expect(screen.getByRole("heading", { name: "Amendment impact" })).toBeDefined();
    expect(screen.getByTestId("amendment-headline").textContent).toContain("5 of 10");
    expect(screen.getByText(/renal-safety — 4 flips/)).toBeDefined();
    expect(screen.getByText(/anticoag-washout — 1 flip/)).toBeDefined();
    expect(screen.getByText(/Already enrolled/)).toBeDefined();
    expect(screen.getByText(/002-0041/)).toBeDefined();
  });

  it("renders the checks tab with the seeded conflict and its evidence", () => {
    render(<App />);
    fireEvent.click(tab("Checks"));
    expect(screen.getByText("contradictory band")).toBeDefined();
    // Core's evidence string, rendered verbatim — including U+2212 and ∞.
    expect(
      screen.getByText(
        "egfr: inclusion admits [30, ∞) ∩ exclusion fires (−∞, 45) → contradictory band [30, 45)",
      ),
    ).toBeDefined();
    expect(screen.getByText(/1 conflict blocks release/)).toBeDefined();
  });

  it("titles every finding the real engine emits, and counts them in the status bar", () => {
    render(<App />);
    fireEvent.click(tab("Checks"));
    expect(screen.getByText("unit mismatch")).toBeDefined();
    expect(screen.getByText("unmodeled criterion")).toBeDefined();
    expect(screen.queryByText("unmodeled-criterion")).toBeNull();
    expect(screen.getByText(/✕ 1 conflict$/)).toBeDefined();
    expect(screen.getByText(/! 1 warning$/)).toBeDefined();
  });

  it("flags every tab as stale when the document stops parsing, and does not count down", async () => {
    render(<App />);
    const badge = () => Number(tab("Checks").textContent!.replace(/\D/g, "")) || 0;
    const before = badge();
    expect(before).toBe(2);

    fireEvent.change(editor(), { target: { value: ":::: not yaml [ { unclosed" } });
    expect(screen.getByTestId("stale-banner")).toBeDefined();

    fireEvent.click(tab("Checks"));
    // The parse error is added to the last valid version's findings — the badge
    // goes UP. The shipped build dropped 2 → 1 when the file broke (operator M6).
    expect(await screen.findByText("rule set does not parse")).toBeDefined();
    expect(badge()).toBeGreaterThanOrEqual(before);
    expect(screen.getByText("contradictory band")).toBeDefined();
    expect(screen.getAllByText(/\(last valid version\)/).length).toBeGreaterThan(0);
    // …and the header no longer claims a version the document does not have.
    expect(screen.queryByText(/static analysis of ruleset v/)).toBeNull();
  });

  it("keeps the stale banner on the quantitative tabs too", () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: "::: broken" } });
    fireEvent.click(tab("Amendment"));
    expect(screen.getByTestId("stale-banner")).toBeDefined();
    expect(screen.getByTestId("amendment-headline")).toBeDefined();
  });

  it("mounts the real review queue on proposed facts from corpus/facts", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    expect(screen.getByRole("region", { name: "Proposed facts pending review" })).toBeDefined();
    const cards = screen.getAllByTestId("review-card");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]!.getAttribute("data-fact")).toBe("egfr");
    expect(screen.getByTestId("as-of").textContent).toContain("as of 0 of 5 facts reviewed");
  });

  it("shows the value on record beside the proposal, and names it an override", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    const card = screen
      .getAllByTestId("review-card")
      .find((c) => c.getAttribute("data-patient") === "SYN-019" && c.getAttribute("data-fact") === "egfr")!;
    const notice = within(card).getByTestId("override-notice");
    expect(notice.textContent).toContain("42"); // structured record
    expect(notice.textContent).toContain("62"); // proposal
    expect(notice.textContent).toContain("replaces the value already on record");
    expect(within(card).getByRole("button", { name: /confirm egfr for SYN-019/ }).textContent).toBe(
      "Confirm override",
    );
  });

  it("badges a fact no criterion reads, instead of implying it matters", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    const card = screen
      .getAllByTestId("review-card")
      .find((c) => c.getAttribute("data-fact") === "nt_probnp")!;
    expect(within(card).getByTestId("unused-badge").textContent).toContain(
      "not read by any criterion",
    );
  });

  it("blocks Save on a value the engine could not use, and changes nothing", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "edit egfr for SYN-019" }));
    fireEvent.change(screen.getByLabelText("corrected value for egfr"), {
      target: { value: "banana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("edit-error").textContent).toContain("not a number");
    // Still editing, still queued, and the funnel is untouched.
    expect(screen.getByLabelText("corrected value for egfr")).toBeDefined();
    expect(screen.getByTestId("as-of").textContent).toContain("as of 0 of 5 facts reviewed");
    fireEvent.click(tab("Screening funnel"));
    expect(within(screen.getByTestId("funnel-totals")).getByText(/^7 screen fail$/)).toBeDefined();
  });

  it("accepts a correction the engine can use", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "edit egfr for SYN-019" }));
    fireEvent.change(screen.getByLabelText("corrected value for egfr"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByTestId("edit-error")).toBeNull();
    expect(screen.getByTestId("as-of").textContent).toContain("as of 1 of 5 facts reviewed");
  });

  it("moves the bands when a fact is confirmed (G10), same numbers on every tab", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "confirm egfr for SYN-019" }));

    fireEvent.click(tab("Screening funnel"));
    const totals = screen.getByTestId("funnel-totals");
    expect(within(totals).getByText(/^6 screen fail$/)).toBeDefined();
    expect(within(totals).getByText(/^4 pending chart review$/)).toBeDefined();

    // The drill-down badge agrees with the totals it sits under.
    fireEvent.click(screen.getByText("nyha-class-iv"));
    fireEvent.click(screen.getByRole("button", { name: /SYN-019/ }));
    expect(screen.getByTestId("drill-band").textContent).toContain("pending chart review");
  });

  it("settles the chart review from a confirmed NYHA, and the funnel moves (cluster C)", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "confirm egfr for SYN-019" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm nyha_class for SYN-019" }));

    fireEvent.click(tab("Screening funnel"));
    const totals = screen.getByTestId("funnel-totals");
    expect(within(totals).getByText(/^1 potentially eligible$/)).toBeDefined();
    expect(within(totals).getByText(/^3 pending chart review$/)).toBeDefined();
  });

  it("excludes the patient when the reviewer records NYHA class IV", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "confirm egfr for SYN-019" }));
    fireEvent.click(screen.getByRole("button", { name: "edit nyha_class for SYN-019" }));
    fireEvent.change(screen.getByLabelText("corrected value for nyha_class"), {
      target: { value: "IV" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    fireEvent.click(tab("Screening funnel"));
    expect(within(screen.getByTestId("funnel-totals")).getByText(/^7 screen fail$/)).toBeDefined();
    fireEvent.click(screen.getByText("nyha-class-iv"));
    fireEvent.click(screen.getByRole("button", { name: /SYN-019/ }));
    expect(screen.getByTestId("drill-band").textContent).toContain("screen fail");
    expect(screen.getByText(/nyha_class = IV \(confirmed in review\)/)).toBeDefined();
  });

  it("keeps a rejected fact out of the engine but keeps the record", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "reject egfr for SYN-019" }));

    fireEvent.click(tab("Screening funnel"));
    expect(within(screen.getByTestId("funnel-totals")).getByText(/^7 screen fail$/)).toBeDefined();
    // The structured 42 is still there — rejecting a proposal is not a delete.
    fireEvent.click(screen.getByText("renal-safety"));
    fireEvent.click(screen.getByRole("button", { name: /SYN-019/ }));
    expect(screen.getByText(/egfr = 42, required < 45, exclusion fired/)).toBeDefined();
  });

  it("persists decisions across a remount", () => {
    const first = render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "confirm egfr for SYN-019" }));
    first.unmount();

    render(<App />);
    fireEvent.click(tab("Review"));
    expect(screen.getByTestId("as-of").textContent).toContain("as of 1 of 5 facts reviewed");
  });

  it("says 0 pending, not '1 patient', once the queue is empty", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    let card = screen.queryAllByTestId("review-card")[0];
    while (card) {
      const fact = card.getAttribute("data-fact")!;
      const patient = card.getAttribute("data-patient")!;
      fireEvent.click(screen.getByRole("button", { name: `reject ${fact} for ${patient}` }));
      card = screen.queryAllByTestId("review-card")[0];
    }
    expect(screen.getByText(/0 pending — every proposed fact has been decided/)).toBeDefined();
    expect(screen.getByTestId("queue-count").textContent).toBe("0 pending");
  });

  it("copies a previewed threshold back into the editor's YAML", () => {
    render(<App />);
    fireEvent.click(tab("Thresholds"));
    // Top of the yield list: renal-safety 45 -> 40, the biggest single return.
    fireEvent.click(screen.getByRole("button", { name: /renal-safety\s+45 → 40/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copy threshold back to YAML" }));
    expect(editor().value).toContain("op: lt, value: 40");
  });
});
