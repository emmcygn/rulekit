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
    expect(screen.getByText(/6 screen fail/)).toBeDefined();
  });

  it("drills from a criterion row into a patient trace", () => {
    render(<App />);
    // SYN-042 leaves the funnel at E1 (no medication reconciliation), so drill in
    // from a criterion whose pool still contains them.
    fireEvent.click(screen.getByText("egfr-min"));
    fireEvent.click(screen.getByRole("button", { name: /SYN-042/ }));
    expect(screen.getByText(/egfr = 41, required < 45, exclusion fired/)).toBeDefined();
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
    expect(screen.getByText(/renal-safety — 4 flips/)).toBeDefined();
    expect(screen.getByText(/Already enrolled/)).toBeDefined();
    expect(screen.getByText(/002-0041/)).toBeDefined();
  });

  it("renders the checks tab with the seeded conflict and its evidence", () => {
    render(<App />);
    fireEvent.click(tab("Checks"));
    expect(screen.getByText("contradictory band")).toBeDefined();
    expect(screen.getByText(/contradictory band \[30, 45\)/)).toBeDefined();
    expect(screen.getByText(/1 conflict blocks release/)).toBeDefined();
  });

  it("renders the review tab as a phase-4 placeholder", () => {
    render(<App />);
    fireEvent.click(tab("Review"));
    expect(screen.getByText(/Coming in phase 4/)).toBeDefined();
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
