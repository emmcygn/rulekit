/**
 * promptfoo test cases, generated from evals/expected-facts.yaml.
 *
 * Generated rather than hand-listed so there is exactly one ground truth in the
 * repo: `facts eval` and `promptfoo eval` score the same expectations, and
 * adding a note means editing one file.
 */
import { parse as parseYaml } from "yaml";
import { expectedFactsYaml } from "./lib.js";

export default async function generateTests() {
  const { cases } = parseYaml(expectedFactsYaml());

  return cases.map((c) => ({
    description: `${c.doc} (${c.patient}) — ${String(c.note ?? "").trim()}`,
    vars: {
      doc: c.doc,
      ...(c.patient === undefined ? {} : { patient: c.patient }),
      expected: c.expected,
      // Declared, reviewed shortfalls in the committed baseline. The assertion
      // allows exactly this many and no more.
      ...(c.knownGap === undefined ? {} : { knownGap: c.knownGap }),
    },
    assert: [
      // Structured outputs must actually hold.
      { type: "is-json" },
      // The real gate + exact-fact matcher.
      { type: "javascript", value: "file://assertions/grounded.js" },
    ],
  }));
}
