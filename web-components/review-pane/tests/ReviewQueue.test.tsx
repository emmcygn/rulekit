import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewQueue } from "../src/ReviewQueue.js";
import type { ProposedFactCard } from "../src/types.js";

const NOTE = "He reports marked limitation of physical activity; symptoms consistent with NYHA class III heart failure. He was hospitalized in November 2025.";

const card = (over: Partial<ProposedFactCard> & { id: string }): ProposedFactCard => ({
  patient: "SYN-042",
  fact: "nyha_class",
  value: "III",
  confidence: 0.94,
  doc: "echo-2026-03-12",
  quote: "symptoms consistent with NYHA class III heart failure",
  noteContext: NOTE,
  flipsVerdict: false,
  ...over,
});

const handlers = () => ({ onConfirm: vi.fn(), onEdit: vi.fn(), onReject: vi.fn() });

const renderedOrder = (): string[] =>
  screen.getAllByTestId("review-card").map((el) => el.getAttribute("data-fact") ?? "");

describe("ReviewQueue — rendered order", () => {
  it("renders impact first, then ascending confidence", () => {
    render(
      <ReviewQueue
        {...handlers()}
        items={[
          card({ id: "1", fact: "nt_probnp", confidence: 0.96, flipsVerdict: false }),
          card({ id: "2", fact: "lvef", confidence: 0.98, flipsVerdict: true, impact: "undetermined → ineligible" }),
          card({ id: "3", fact: "egfr", confidence: 0.6, flipsVerdict: false }),
          card({ id: "4", fact: "nyha_class", confidence: 0.72, flipsVerdict: true }),
        ]}
      />,
    );
    expect(renderedOrder()).toEqual(["nyha_class", "lvef", "egfr", "nt_probnp"]);
  });

  it("keeps a 0.55 verdict-flipping fact above a 0.99 quiet one", () => {
    render(
      <ReviewQueue
        {...handlers()}
        items={[
          card({ id: "quiet", fact: "potassium", confidence: 0.99, flipsVerdict: false }),
          card({ id: "loud", fact: "lvef", confidence: 0.55, flipsVerdict: true }),
        ]}
      />,
    );
    expect(renderedOrder()).toEqual(["lvef", "potassium"]);
  });
});

describe("ReviewQueue — card contents", () => {
  it("shows patient, fact, value and unit", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1", fact: "lvef", value: 32, unit: "%" })]} />);
    const c = screen.getByTestId("review-card");
    expect(within(c).getByText("SYN-042")).toBeInTheDocument();
    expect(within(c).getByText("lvef")).toBeInTheDocument();
    expect(within(c).getByText("32 %")).toBeInTheDocument();
  });

  it("renders confidence as an accessible meter", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1", confidence: 0.94 })]} />);
    const meter = screen.getByRole("meter", { name: /confidence for nyha_class/i });
    expect(meter).toHaveAttribute("aria-valuenow", "94");
    expect(screen.getByText("94%")).toBeInTheDocument();
  });

  it("flags confidence below 0.8 as unsure", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1", confidence: 0.71 })]} />);
    expect(screen.getByText("unsure")).toBeInTheDocument();
  });

  it("does not flag a confident fact", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1", confidence: 0.94 })]} />);
    expect(screen.queryByText("unsure")).not.toBeInTheDocument();
  });

  it("honours a custom unsure threshold", () => {
    render(<ReviewQueue {...handlers()} unsureBelow={0.99} items={[card({ id: "1", confidence: 0.94 })]} />);
    expect(screen.getByText("unsure")).toBeInTheDocument();
  });

  it("shows an impact badge only on verdict-flipping facts", () => {
    render(
      <ReviewQueue
        {...handlers()}
        items={[
          card({ id: "1", fact: "lvef", flipsVerdict: true, impact: "undetermined → ineligible" }),
          card({ id: "2", fact: "egfr", flipsVerdict: false }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("impact-badge")).toHaveLength(1);
    expect(screen.getByText("undetermined → ineligible")).toBeInTheDocument();
  });

  it("highlights the quote inside the note context", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1" })]} />);
    const mark = screen.getByText("symptoms consistent with NYHA class III heart failure");
    expect(mark.tagName).toBe("MARK");
    expect(screen.getByText(/He was hospitalized in November 2025/)).toBeInTheDocument();
  });

  it("warns instead of highlighting when the quote no longer resolves", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1", quote: "a quote that is not in the note" })]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/no longer appears/i);
    expect(document.querySelector("mark")).toBeNull();
  });

  it("names the source document", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1" })]} />);
    expect(screen.getByText("echo-2026-03-12")).toBeInTheDocument();
  });
});

describe("ReviewQueue — the three actions", () => {
  it("confirms exactly the card that was clicked", async () => {
    const h = handlers();
    const a = card({ id: "a", fact: "lvef", confidence: 0.6 });
    const b = card({ id: "b", fact: "egfr", confidence: 0.9 });
    render(<ReviewQueue {...h} items={[a, b]} />);

    await userEvent.click(screen.getByRole("button", { name: /confirm egfr/i }));
    expect(h.onConfirm).toHaveBeenCalledExactlyOnceWith(b);
    expect(h.onReject).not.toHaveBeenCalled();
  });

  it("rejects exactly the card that was clicked", async () => {
    const h = handlers();
    const a = card({ id: "a" });
    render(<ReviewQueue {...h} items={[a]} />);

    await userEvent.click(screen.getByRole("button", { name: /reject nyha_class/i }));
    expect(h.onReject).toHaveBeenCalledExactlyOnceWith(a);
  });

  it("edits: opens an input seeded with the proposed value and reports the correction", async () => {
    const h = handlers();
    const a = card({ id: "a", value: "III" });
    render(<ReviewQueue {...h} items={[a]} />);

    await userEvent.click(screen.getByRole("button", { name: /edit nyha_class/i }));
    const input = screen.getByRole("textbox", { name: /corrected value for nyha_class/i });
    expect(input).toHaveValue("III");

    await userEvent.clear(input);
    await userEvent.type(input, "II");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(h.onEdit).toHaveBeenCalledExactlyOnceWith(a, "II");
  });

  it("cancelling an edit reports nothing", async () => {
    const h = handlers();
    render(<ReviewQueue {...h} items={[card({ id: "a" })]} />);

    await userEvent.click(screen.getByRole("button", { name: /edit nyha_class/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /confirm nyha_class/i })).toBeInTheDocument();
  });

  it("never confirms anything on its own — rendering fires no callback", () => {
    const h = handlers();
    render(<ReviewQueue {...h} items={[card({ id: "a", confidence: 1 }), card({ id: "b", confidence: 0.99 })]} />);
    expect(h.onConfirm).not.toHaveBeenCalled();
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(h.onReject).not.toHaveBeenCalled();
  });

  it("offers exactly three actions per card — no bulk operations", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "a" })]} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

describe("ReviewQueue — queue state", () => {
  it("counts the queue and how many change a verdict", () => {
    render(
      <ReviewQueue
        {...handlers()}
        items={[card({ id: "a", flipsVerdict: true }), card({ id: "b", fact: "lvef" }), card({ id: "c", fact: "egfr" })]}
      />,
    );
    expect(screen.getByTestId("queue-count")).toHaveTextContent("3 pending · 1 change a verdict");
  });

  it("omits the impact clause when nothing changes a verdict", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "a" })]} />);
    expect(screen.getByTestId("queue-count")).toHaveTextContent("1 pending");
    expect(screen.getByTestId("queue-count")).not.toHaveTextContent("change a verdict");
  });

  it("says so when the queue is empty", () => {
    render(<ReviewQueue {...handlers()} items={[]} />);
    expect(screen.getByText(/Nothing pending/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId("review-card")).toHaveLength(0);
  });

  it("labels the region for screen readers", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "a" })]} />);
    expect(screen.getByRole("region", { name: /pending review/i })).toBeInTheDocument();
  });
});

describe("ReviewQueue — the host's refusals are honoured", () => {
  it("blocks Save on a value the host rejects, and never reports the edit", async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(
      <ReviewQueue
        {...h}
        items={[card({ id: "1", fact: "egfr", value: "62", unit: "mL/min/1.73m2" })]}
        validate={(_item, draft) =>
          /^-?\d+(\.\d+)?$/.test(draft.trim())
            ? { ok: true }
            : { ok: false, message: `"${draft}" is not a number.` }
        }
      />,
    );
    await user.click(screen.getByRole("button", { name: /edit egfr/ }));
    const input = screen.getByLabelText("corrected value for egfr");
    await user.clear(input);
    await user.type(input, "banana");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("edit-error")).toHaveTextContent("not a number");
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");

    // …and the same box accepts a usable correction.
    await user.clear(input);
    await user.type(input, "47");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onEdit.mock.calls[0]![1]).toBe("47");
  });

  it("shows the value on record beside the proposal and calls confirming it an override", () => {
    render(
      <ReviewQueue
        {...handlers()}
        items={[card({ id: "1", fact: "egfr", value: "62", structured: "42", unit: "mL/min/1.73m2" })]}
      />,
    );
    const notice = screen.getByTestId("override-notice");
    expect(notice).toHaveTextContent("42");
    expect(notice).toHaveTextContent("62");
    expect(notice).toHaveTextContent("replaces the value already on record");
    expect(screen.getByRole("button", { name: /confirm egfr/ })).toHaveTextContent("Confirm override");
  });

  it("badges a fact no criterion reads", () => {
    render(<ReviewQueue {...handlers()} items={[card({ id: "1", usedByRules: false })]} />);
    expect(screen.getByTestId("unused-badge")).toHaveTextContent("not read by any criterion");
  });

  it("offers a closed value set when the host supplies one", async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(
      <ReviewQueue
        {...h}
        items={[card({ id: "1" })]}
        optionsFor={() => ["I", "II", "III", "IV"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /edit nyha_class/ }));
    const select = screen.getByLabelText("corrected value for nyha_class");
    await user.selectOptions(select, "IV");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(h.onEdit.mock.calls[0]![1]).toBe("IV");
  });

  it("renders an excerpt with an expand control rather than the whole note", async () => {
    const user = userEvent.setup();
    const long = [
      "Opening paragraph nobody needs.",
      "Second sentence of preamble.",
      "The lead-in.",
      "Labs today show eGFR 62 mL/min/1.73m2 on a stable creatinine.",
      "The trailing sentence.",
      "Electronically signed by a fictional clinician.",
    ].join(" ");
    render(
      <ReviewQueue
        {...handlers()}
        items={[
          card({ id: "1", fact: "egfr", quote: "eGFR 62 mL/min/1.73m2", noteContext: long }),
        ]}
      />,
    );
    expect(screen.getByText(/eGFR 62 mL\/min\/1\.73m2/)).toBeDefined();
    expect(screen.queryByText(/Opening paragraph nobody needs/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "show full note" }));
    expect(screen.getByText(/Opening paragraph nobody needs/, { exact: false })).toBeDefined();
  });
});
