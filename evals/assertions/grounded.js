/**
 * The custom assertion: run the real grounding gate over the model's output,
 * then match what survives against the authored ground truth.
 *
 * This is the whole reason the harness is promptfoo-plus-custom-JS rather than
 * a pile of `contains` assertions: the thing worth asserting is not that a
 * string appears, it is that every emitted fact carries evidence that resolves
 * in the source note and parses to its declared type — and that the facts that
 * survive are exactly the ones the note states.
 *
 * Scoring: 1.0 only when grounding is clean AND the surviving set equals the
 * expected set. A correct rejection (the range trap, the fabricated quote) is
 * not a failure — the note states no such fact, so killing it is the right
 * answer and the case still scores 1.0.
 */
import { pipeline } from "../lib.js";

export default async function assertGrounded(output, context) {
  const doc = context?.vars?.doc;
  const expected = context?.vars?.expected ?? [];

  let parsedOutput;
  try {
    parsedOutput = typeof output === "string" ? JSON.parse(output) : output;
  } catch {
    return { pass: false, score: 0, reason: "output is not JSON — structured outputs did not hold" };
  }

  const { pipe, ground, evalMod, ctx } = await pipeline();

  let proposed;
  try {
    proposed = pipe.parseResponse(parsedOutput);
  } catch (err) {
    return { pass: false, score: 0, reason: err.message };
  }

  const result = ground.groundProposedFacts(proposed, {
    doc,
    extractedBy: "llm/eval",
    ctx,
  });

  const report = evalMod.scoreExtraction([{ doc, expected, result }]);
  const { tp, fp, fn } = report.counts;

  const notes = [];
  for (const r of result.rejected) notes.push(`rejected ${r.fact} (${r.reasons.join(", ")})`);
  for (const j of report.judgements) {
    if (j.kind === "fp") notes.push(`FP ${j.fact}=${JSON.stringify(j.proposedValue)} — not stated in the note`);
    if (j.kind === "fn") notes.push(`FN ${j.fact}=${JSON.stringify(j.expectedValue)} — ${j.fnCause}`);
  }

  // A declared, reviewed shortfall in the committed baseline (see
  // evals/expected-facts.yaml). Exactly this many are tolerated; one more is a
  // regression. Nothing is silently forgiven.
  const gap = context?.vars?.knownGap ?? null;
  const allowedFp = gap?.fp ?? 0;
  const allowedFn = gap?.fn ?? 0;
  const pass = fp <= allowedFp && fn <= allowedFn;

  const clean = `${tp}/${expected.length} facts extracted and grounded`;
  const gateNote = result.rejected.length ? `; ${result.rejected.length} rejected at the gate` : "";
  const gapNote = gap && (fp > 0 || fn > 0) ? ` [known gap allowed: ${gap.why.trim().split("\n")[0]}]` : "";

  const reason = pass
    ? `${clean}${gateNote}${gapNote}`
    : `regression — tp ${tp}, fp ${fp} (allowed ${allowedFp}), fn ${fn} (allowed ${allowedFn}): ${notes.join("; ")}`;

  const denominator = expected.length + fp;
  return { pass, score: denominator === 0 ? 1 : tp / denominator, reason };
}
