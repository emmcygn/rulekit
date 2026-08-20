import { describe, it, expect } from "vitest";
import { parseNote, loadNotesDir, NOTES_DIR } from "../../src/extract/notes.js";

describe("parseNote", () => {
  const SRC = ["---", "doc: echo-x", "patient: SYN-1", "kind: echo-report", "synthetic: true", "---", "body line one", "body line two", ""].join("\n");

  it("splits front matter from body", () => {
    const n = parseNote(SRC, "echo-x.txt");
    expect(n.doc).toBe("echo-x");
    expect(n.patient).toBe("SYN-1");
    expect(n.body).toBe("body line one\nbody line two\n");
  });

  it("keeps front matter out of the groundable body", () => {
    expect(parseNote(SRC, "echo-x.txt").body).not.toContain("synthetic");
  });

  it("rejects a note with no front matter", () => {
    expect(() => parseNote("just text", "x.txt")).toThrow(/front matter/);
  });

  it("rejects a note that is not marked synthetic", () => {
    expect(() => parseNote(SRC.replace("synthetic: true", "synthetic: false"), "x.txt")).toThrow(/synthetic/);
  });

  it("rejects a note whose doc id does not match its filename", () => {
    expect(() => parseNote(SRC, "other.txt")).toThrow(/filename/);
  });

  it("normalizes CRLF to LF in the body", () => {
    const crlf = SRC.replace(/\n/g, "\r\n");
    expect(parseNote(crlf, "echo-x.txt").body).toBe("body line one\nbody line two\n");
  });
});

describe("the shipped note corpus", () => {
  const notes = loadNotesDir(NOTES_DIR);

  it("has 10 notes, all synthetic, all uniquely keyed", () => {
    expect(Object.keys(notes)).toHaveLength(10);
    for (const n of Object.values(notes)) expect(n.synthetic).toBe(true);
  });

  it("covers both echo reports and clinic notes", () => {
    const kinds = new Set(Object.values(notes).map((n) => n.kind));
    expect(kinds).toEqual(new Set(["echo-report", "clinic-note"]));
  });

  it("attaches every note to a distinct patient", () => {
    const patients = Object.values(notes).map((n) => n.patient);
    expect(new Set(patients).size).toBe(patients.length);
  });

  it("carries the seeded traps verbatim", () => {
    expect(notes["echo-2026-01-22"]!.body).toContain("EF visually estimated at 40-45%");
    expect(notes["clinic-2026-04-02"]!.body).toContain("no anticoagulant use since the GI bleed");
    expect(notes["clinic-2026-07-09"]!.body).toContain("did not start it today");
    expect(notes["clinic-2026-08-05"]!.body).toContain("NYHA class IV at the time of his 2024 admission");
    expect(notes["clinic-2026-05-16"]!.body).toContain("stop metoprolol succinate today and start carvedilol");
  });

  it("never breaks a sentence across a newline (quotes must survive)", () => {
    // A line ending without terminal punctuation, followed by a lowercase
    // continuation, means a quote spanning the two would fail the gate.
    for (const [id, n] of Object.entries(notes)) {
      const lines = n.body.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const cur = lines[i]!.trimEnd();
        const raw = lines[i + 1]!;
        const next = raw.trimStart();
        if (cur === "" || next === "") continue;
        // An indented line is a new list item (a lab row, a med row), not a
        // reflowed continuation of the line above it.
        if (/^\s/.test(raw)) continue;
        const wrapped = !/[.:;,)%\d]$/.test(cur) && /^[a-z]/.test(next);
        expect(wrapped, `${id} wraps mid-sentence: "${cur}" / "${next}"`).toBe(false);
      }
    }
  });
});
