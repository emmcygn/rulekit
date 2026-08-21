// @vitest-environment jsdom
/**
 * Crash guard: every tab renders against the bundled demo data. Monaco is
 * stubbed — it needs a real browser, and the editor itself is not under test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

vi.mock("../src/editor/RuleEditor.js", () => ({
  RuleEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));

import { App } from "../src/App.js";

const tab = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("workbench shell", () => {
  it("opens on the funnel with the demo cohort counted", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Screening funnel" })).toBeDefined();
    expect(screen.getByText(/cohort n = 10/)).toBeDefined();
    expect(screen.getAllByText(/3 potentially eligible/).length).toBeGreaterThan(0);
    expect(screen.getByText(/4 screen fail/)).toBeDefined();
    // Three patients have a fact pending review, so the engine cannot see it.
    expect(screen.getByText(/3 not evaluable/)).toBeDefined();
  });

  it("drills from a criterion row into a patient trace", () => {
    render(<App />);
    // SYN-058 has no facts file, so nothing of theirs is pending review and they
    // reach the renal exclusion that the amendment added.
    fireEvent.click(screen.getByText("renal-safety"));
    fireEvent.click(screen.getByRole("button", { name: /SYN-058/ }));
    expect(screen.getByText(/egfr = 33, required < 45, exclusion fired/)).toBeDefined();
  });

  it("renders the thresholds tab with a live re-count", () => {
    render(<App />);
    fireEvent.click(tab("Thresholds"));
    expect(screen.getByRole("heading", { name: "Threshold impact" })).toBeDefined();
    expect(screen.getByRole("slider")).toBeDefined();
    expect(screen.getByText(/top criteria by yield if relaxed/)).toBeDefined();
  });

  it("renders the amendment tab with flips and the enrolled warning", () => {
    render(<App />);
    fireEvent.click(tab("Amendment"));
    expect(screen.getByRole("heading", { name: "Amendment impact" })).toBeDefined();
    // Two of the four flips are held back: SYN-007 and SYN-019 have an eGFR
    // sitting in the review queue, so the engine cannot decide them either way.
    expect(screen.getByText(/renal-safety — 2 flips/)).toBeDefined();
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
    // No raw code leaks through as a title.
    expect(screen.queryByText("unmodeled-criterion")).toBeNull();
    expect(screen.getByText(/✕ 1 conflict$/)).toBeDefined();
    expect(screen.getByText(/! 1 warning$/)).toBeDefined();
  });

  it("mounts the real review queue on proposed facts from corpus/facts", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    expect(screen.getByRole("region", { name: "Proposed facts pending review" })).toBeDefined();
    const cards = screen.getAllByTestId("review-card");
    expect(cards.length).toBeGreaterThan(0);
    // Impact sorts first: the eGFR that would move a patient out of the hatched
    // band leads the queue, ahead of higher-confidence facts nothing reads.
    expect(cards[0]!.getAttribute("data-fact")).toBe("egfr");
    expect(screen.getByTestId("queue-count").textContent).toContain("change a verdict");
  });

  it("shrinks the not-evaluable band when a fact is confirmed (G10)", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "confirm egfr for SYN-007" }));

    fireEvent.click(tab("Screening funnel"));
    expect(screen.getByText(/2 not evaluable/)).toBeDefined();
    expect(screen.getAllByText(/4 potentially eligible/).length).toBeGreaterThan(0);
  });

  it("keeps a rejected fact out of the engine", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "reject egfr for SYN-007" }));

    fireEvent.click(tab("Screening funnel"));
    expect(screen.getByText(/3 not evaluable/)).toBeDefined();
  });

  it("copies a previewed threshold back into the editor's YAML", () => {
    render(<App />);
    fireEvent.click(tab("Thresholds"));
    // Top of the yield list: lvef-max 40 -> 45.
    fireEvent.click(screen.getByRole("button", { name: /lvef-max\s+40 → 45/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copy threshold back to YAML" }));
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(editor.value).toContain("op: lte, value: 45");
  });
});
