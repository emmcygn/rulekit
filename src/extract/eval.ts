/**
 * `facts eval` — the domain metrics promptfoo cannot express (design spec §11).
 *
 * Ground truth exists by construction: we author the corpus notes, so every
 * expected fact is known. That makes three numbers meaningful:
 *
 *   - fact-level precision / recall over the corpus;
 *   - corpus-level grounding pass rate, split into rejections that *caught* a
 *     wrong fact and rejections that *over-blocked* a right one — the honest
 *     cost of the gate's strictness, and the number to look at before loosening
 *     it;
 *   - the confidence-calibration table: the model's self-estimate bucketed
 *     against whether the fact was actually right. Self-estimates are not
 *     calibrated probabilities, and this table is how you show that rather than
 *     assert it.
 *
 * Pure: no filesystem, no clock. The CLI feeds it, it computes.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { FactEntry, FactFileValue } from "./schema.js";
import type { GroundingResult, Rejection, RejectionReason } from "./ground.js";
import type { RecordedResponse } from "./recorded.js";

export type ExpectedFact = { fact: string; value: FactFileValue; unit?: string };

/**
 * A named, reviewed shortfall in the committed baseline.
 *
 * A permanently-red eval teaches a team to ignore the eval, and a baseline
 * forced to 100% teaches it nothing at all. So the two misses in the recorded
 * run are declared here, in the ground truth, where a reviewer reads them —
 * with the reason spelled out. The harness allows exactly this many and no
 * more, so a new error still fails.
 */
export type KnownGap = { fp?: number; fn?: number; why: string };

export type ExpectedCase = {
  doc: string;
  patient?: string;
  note?: string;
  knownGap?: KnownGap;
  expected: ExpectedFact[];
};
export type DatasetMetadata = {
  id: string;
  synthetic: boolean;
  caseCount: number;
  limitations: string;
};
export type ExpectedFile = { metadata: DatasetMetadata; cases: ExpectedCase[] };

/** One case's extraction output, as produced by extractFacts(). */
export type ScoredCase = {
  doc: string;
  expected: ExpectedFact[];
  result: GroundingResult;
  recording?: Pick<RecordedResponse, "capture">;
};

export type Judgement = {
  doc: string;
  fact: string;
  kind: "tp" | "fp" | "fn";
  expectedValue?: FactFileValue;
  proposedValue?: unknown;
  confidence?: number;
  /** For an fn: was the fact never proposed, or proposed right and blocked by the gate? */
  fnCause?: "not-proposed" | "over-blocked";
};

export type CalibrationBucket = {
  lo: number;
  hi: number;
  n: number;
  meanConfidence: number | null;
  /** Fraction of grounded facts in this bucket that were correct. */
  accuracy: number | null;
  /** meanConfidence - accuracy. Positive means overconfident. */
  gap: number | null;
};

export type EvalReport = {
  cases: number;
  dataset?: DatasetMetadata;
  counts: { tp: number; fp: number; fn: number; expected: number };
  precision: number;
  recall: number;
  f1: number;
  grounding: {
    proposed: number;
    grounded: number;
    rejected: number;
    passRate: number;
    /** Rejections that killed a fact the corpus does not contain. The gate earning its keep. */
    caught: number;
    /** Rejections that killed a fact the corpus does contain. The gate's cost. */
    overBlocked: number;
    byReason: Partial<Record<RejectionReason, number>>;
  };
  perFact: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number }>;
  calibration: { buckets: CalibrationBucket[]; ece: number };
  operational: {
    capturesWithMetrics: number;
    latency: { samples: number; meanMs: number; p50Ms: number; p95Ms: number } | null;
    usage: {
      samples: number;
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      thinkingTokens: number;
    } | null;
    /** Null unless a provider-supplied or versioned pricing calculation is recorded. */
    estimatedCostUsd: number | null;
  };
  judgements: Judgement[];
};

const expectedFactSchema = z.strictObject({
  fact: z.string(),
  value: z.union([z.number(), z.boolean(), z.array(z.strictObject({ code: z.coerce.string(), system: z.string(), daysAgo: z.number().optional() })), z.string()]),
  unit: z.string().optional(),
});
const expectedFileSchema = z.strictObject({
  metadata: z.strictObject({
    id: z.string().min(1),
    synthetic: z.boolean(),
    caseCount: z.number().int().positive(),
    limitations: z.string().min(1),
  }),
  cases: z.array(
    z.strictObject({
      doc: z.string(),
      patient: z.string().optional(),
      note: z.string().optional(),
      knownGap: z
        .strictObject({
          fp: z.number().int().nonnegative().optional(),
          fn: z.number().int().nonnegative().optional(),
          why: z.string().min(1),
        })
        .optional(),
      expected: z.array(expectedFactSchema),
    }),
  ),
});

export function parseExpectedFacts(yamlText: string): ExpectedFile {
  const result = expectedFileSchema.safeParse(parseYaml(yamlText));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid expected-facts file: ${issues}`);
  }
  if (result.data.metadata.caseCount !== result.data.cases.length) {
    throw new Error(
      `invalid expected-facts file: metadata.caseCount is ${result.data.metadata.caseCount}, but ${result.data.cases.length} cases are present`,
    );
  }
  return result.data as ExpectedFile;
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const matches = (grounded: FactEntry, expected: ExpectedFact): boolean =>
  grounded.fact === expected.fact &&
  sameValue(grounded.value, expected.value) &&
  (expected.unit === undefined || grounded.unit === expected.unit);

/**
 * Did this rejection kill something the corpus actually contains? Rejections
 * carry the model's raw string value, so the comparison is on the string form.
 */
const rejectionWasCorrect = (r: Rejection, expected: ExpectedFact[]): boolean =>
  expected.some((e) => e.fact === r.fact && String(e.value) === String(r.value));

function bucketize(
  scored: { confidence: number; correct: boolean }[],
  bucketCount: number,
): { buckets: CalibrationBucket[]; ece: number } {
  const width = 1 / bucketCount;
  const buckets: CalibrationBucket[] = [];
  let ece = 0;

  // Round the bounds: `3 * (1/5)` is 0.6000000000000001, and a bucket labelled
  // that way is a bug report waiting to happen.
  const bound = (i: number): number => Math.round(i * width * 1e6) / 1e6;

  for (let i = 0; i < bucketCount; i++) {
    const lo = bound(i);
    const hi = bound(i + 1);
    // Half-open bins, except the last which closes on 1.0 so a perfect
    // self-estimate lands somewhere.
    const inBin = scored.filter((s) => s.confidence >= lo && (i === bucketCount - 1 ? s.confidence <= hi : s.confidence < hi));
    if (inBin.length === 0) {
      buckets.push({ lo, hi, n: 0, meanConfidence: null, accuracy: null, gap: null });
      continue;
    }
    const meanConfidence = inBin.reduce((a, s) => a + s.confidence, 0) / inBin.length;
    const accuracy = inBin.filter((s) => s.correct).length / inBin.length;
    buckets.push({ lo, hi, n: inBin.length, meanConfidence, accuracy, gap: meanConfidence - accuracy });
    ece += (inBin.length / scored.length) * Math.abs(meanConfidence - accuracy);
  }

  return { buckets, ece: scored.length === 0 ? 0 : ece };
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

/**
 * Score one corpus run.
 *
 * Recall is measured against what reached the facts file, not against what the
 * model said: a fact the model got right and the gate blocked is still a miss
 * from the reviewer's seat. `fnCause` keeps the two apart.
 */
const percentile = (values: readonly number[], quantile: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
};

export function scoreExtraction(
  cases: readonly ScoredCase[],
  opts: { buckets?: number; dataset?: DatasetMetadata } = {},
): EvalReport {
  const judgements: Judgement[] = [];
  const calibrationInput: { confidence: number; correct: boolean }[] = [];
  const byReason: Partial<Record<RejectionReason, number>> = {};
  let proposed = 0;
  let grounded = 0;
  let rejected = 0;
  let caught = 0;
  let overBlocked = 0;

  for (const c of cases) {
    proposed += c.result.grounded.length + c.result.rejected.length;
    grounded += c.result.grounded.length;
    rejected += c.result.rejected.length;

    const unmatched = [...c.expected];

    for (const g of c.result.grounded) {
      const i = unmatched.findIndex((e) => matches(g, e));
      const correct = i !== -1;
      if (correct) unmatched.splice(i, 1);
      judgements.push({
        doc: c.doc,
        fact: g.fact,
        kind: correct ? "tp" : "fp",
        proposedValue: g.value,
        expectedValue: c.expected.find((e) => e.fact === g.fact)?.value,
        confidence: g.confidence,
      });
      if (g.confidence !== undefined) calibrationInput.push({ confidence: g.confidence, correct });
    }

    for (const r of c.result.rejected) {
      for (const reason of r.reasons) byReason[reason] = (byReason[reason] ?? 0) + 1;
      if (rejectionWasCorrect(r, c.expected)) overBlocked++;
      else caught++;
    }

    for (const e of unmatched) {
      const blocked = c.result.rejected.some((r) => r.fact === e.fact && String(r.value) === String(e.value));
      judgements.push({
        doc: c.doc,
        fact: e.fact,
        kind: "fn",
        expectedValue: e.value,
        fnCause: blocked ? "over-blocked" : "not-proposed",
      });
    }
  }

  const tp = judgements.filter((j) => j.kind === "tp").length;
  const fp = judgements.filter((j) => j.kind === "fp").length;
  const fn = judgements.filter((j) => j.kind === "fn").length;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const metrics = cases.flatMap((c) => (c.recording?.capture.metrics ? [c.recording.capture.metrics] : []));
  const latencies = metrics.map((m) => m.latencyMs);
  const operational: EvalReport["operational"] = {
    capturesWithMetrics: metrics.length,
    latency:
      latencies.length === 0
        ? null
        : {
            samples: latencies.length,
            meanMs: latencies.reduce((sum, n) => sum + n, 0) / latencies.length,
            p50Ms: percentile(latencies, 0.5),
            p95Ms: percentile(latencies, 0.95),
          },
    usage:
      metrics.length === 0
        ? null
        : {
            samples: metrics.length,
            inputTokens: metrics.reduce((sum, m) => sum + m.usage.input_tokens, 0),
            outputTokens: metrics.reduce((sum, m) => sum + m.usage.output_tokens, 0),
            cacheCreationInputTokens: metrics.reduce((sum, m) => sum + (m.usage.cache_creation_input_tokens ?? 0), 0),
            cacheReadInputTokens: metrics.reduce((sum, m) => sum + (m.usage.cache_read_input_tokens ?? 0), 0),
            thinkingTokens: metrics.reduce((sum, m) => sum + (m.usage.output_tokens_details?.thinking_tokens ?? 0), 0),
          },
    estimatedCostUsd: null,
  };

  const perFact: EvalReport["perFact"] = {};
  for (const j of judgements) {
    const row = (perFact[j.fact] ??= { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0 });
    row[j.kind]++;
  }
  for (const row of Object.values(perFact)) {
    row.precision = ratio(row.tp, row.tp + row.fp);
    row.recall = ratio(row.tp, row.tp + row.fn);
  }

  return {
    cases: cases.length,
    ...(opts.dataset === undefined ? {} : { dataset: opts.dataset }),
    counts: { tp, fp, fn, expected: cases.reduce((a, c) => a + c.expected.length, 0) },
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    grounding: { proposed, grounded, rejected, passRate: ratio(grounded, proposed), caught, overBlocked, byReason },
    perFact,
    calibration: bucketize(calibrationInput, opts.buckets ?? 5),
    operational,
    judgements,
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** Fixed-width report for `facts eval`. */
export function formatEvalReport(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`extraction eval — ${r.cases} notes, ${r.counts.expected} expected facts`);
  if (r.dataset) {
    lines.push(`dataset ${r.dataset.id} — ${r.dataset.caseCount} ${r.dataset.synthetic ? "synthetic" : "non-synthetic"} notes`);
    lines.push(`  limitation: ${r.dataset.limitations}`);
    lines.push("  these point metrics are regression-fixture results, not statistical confidence estimates");
  }
  lines.push("");
  lines.push(`  precision ${pct(r.precision)}   recall ${pct(r.recall)}   f1 ${pct(r.f1)}`);
  lines.push(`  tp ${r.counts.tp}   fp ${r.counts.fp}   fn ${r.counts.fn}`);
  lines.push("");
  lines.push(`grounding — ${r.grounding.grounded}/${r.grounding.proposed} proposals survived the gate (${pct(r.grounding.passRate)})`);
  lines.push(`  caught ${r.grounding.caught} wrong fact(s), over-blocked ${r.grounding.overBlocked} right one(s)`);
  for (const [reason, n] of Object.entries(r.grounding.byReason).sort((a, b) => b[1] - a[1])) {
    lines.push(`    ${reason.padEnd(20)} ${n}`);
  }
  lines.push("");
  lines.push("confidence calibration (self-estimate vs. actual correctness)");
  lines.push("  bucket        n   mean conf   accuracy   gap");
  for (const b of r.calibration.buckets) {
    const range = `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`.padEnd(12);
    if (b.n === 0) {
      lines.push(`  ${range}  0           -          -      -`);
      continue;
    }
    lines.push(
      `  ${range}  ${String(b.n).padEnd(3)} ${pct(b.meanConfidence!).padStart(9)}  ${pct(b.accuracy!).padStart(9)}  ${(b.gap! >= 0 ? "+" : "") + (b.gap! * 100).toFixed(1)}`,
    );
  }
  lines.push(`  expected calibration error: ${r.calibration.ece.toFixed(3)}`);
  lines.push("  (self-estimates are not calibrated probabilities — this table orders the review queue, nothing else)");
  lines.push("");
  lines.push("capture resources");
  if (!r.operational.latency || !r.operational.usage) {
    lines.push("  unavailable — recordings were migrated from the legacy envelope without fabricating capture metrics");
  } else {
    const latency = r.operational.latency;
    const usage = r.operational.usage;
    lines.push(
      `  latency ${latency.samples} capture(s): mean ${latency.meanMs.toFixed(0)}ms, p50 ${latency.p50Ms.toFixed(0)}ms, p95 ${latency.p95Ms.toFixed(0)}ms`,
    );
    lines.push(
      `  tokens: input ${usage.inputTokens}, output ${usage.outputTokens}, cache-create ${usage.cacheCreationInputTokens}, cache-read ${usage.cacheReadInputTokens}, thinking ${usage.thinkingTokens}`,
    );
    lines.push("  estimated cost unavailable — recordings contain usage, but no versioned provider price schedule");
  }

  const misses = r.judgements.filter((j) => j.kind !== "tp");
  if (misses.length > 0) {
    lines.push("");
    lines.push("misses");
    for (const m of misses) {
      const what = m.kind === "fp" ? `proposed ${JSON.stringify(m.proposedValue)} (unstated)` : `expected ${JSON.stringify(m.expectedValue)} — ${m.fnCause}`;
      lines.push(`  ${m.kind.toUpperCase()} ${m.doc} ${m.fact}: ${what}`);
    }
  }
  return lines.join("\n");
}
