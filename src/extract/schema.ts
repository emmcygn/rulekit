/**
 * The `facts.yaml` file format (design spec §11) — one file per patient in
 * `corpus/facts/`.
 *
 * A facts file is the patient-side mirror of `ruleset.yaml`: it is the only
 * thing the evaluator ever reads about a patient, and every entry in it carries
 * where it came from. Three provenance tiers:
 *
 *   - `pipeline` — deterministic flatten of structured FHIR. No LLM involved.
 *   - `llm/<model>` — extracted from narrative text. Enters as `proposed` and
 *     is invisible to the engine until a human confirms it.
 *   - `human`     — entered or corrected in the review pane.
 *
 * The parse functions here mirror `src/core/schema.ts`: strict objects (a typo
 * is an error, never a silently-ignored key) and one flat error message listing
 * every offending path.
 */
import { z } from "zod";
import { parse as parseYaml } from "yaml";

export type FactStatus = "proposed" | "confirmed" | "rejected";

/** `pipeline` | `human` | `llm/<model-id>` */
export type ExtractedBy = string;

export type FactSource = {
  /** Document id, matching a note in `corpus/notes/`. */
  doc: string;
  /** Verbatim span from that document. Checked by the grounding gate. */
  quote: string;
};

export type CodeEntry = { code: string; system: string; daysAgo?: number };

/**
 * Scalar for narrative-extracted facts; a code list for the deterministic
 * tier (meds, conditions), matching `FactValue` in src/core/schema.ts.
 */
export type FactFileValue = number | string | boolean | CodeEntry[];

export type FactEntry = {
  fact: string;
  value: FactFileValue;
  unit?: string;
  status: FactStatus;
  confidence?: number;
  extractedBy: ExtractedBy;
  source?: FactSource;
  /** When the underlying observation was made (not when it was extracted). */
  measuredAt?: string;
  /** Recency requirement declared on the fact, in days from the file's `asOf`. */
  validWithinDays?: number;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
};

export type FactsFile = {
  patient: string;
  /** Screening date the recency windows are measured against. */
  asOf?: string;
  facts: FactEntry[];
};

const EXTRACTED_BY = /^(pipeline|human|llm\/[A-Za-z0-9][A-Za-z0-9._:-]*)$/;

const codeEntry = z.strictObject({
  code: z.coerce.string(),
  system: z.string(),
  daysAgo: z.number().int().nonnegative().optional(),
});

// Order matters: `z.coerce.string()` would swallow numbers, so the scalar
// branches stay uncoerced and `string` sits last.
const factFileValue = z.union([z.number(), z.boolean(), z.array(codeEntry).min(1), z.string()]);

const factSource = z.strictObject({ doc: z.string().min(1), quote: z.string().min(1) });

const factEntry = z
  .strictObject({
    fact: z.string().regex(/^[a-z][a-z0-9_]*$/, "fact names are snake_case"),
    value: factFileValue,
    unit: z.string().optional(),
    status: z.enum(["proposed", "confirmed", "rejected"]),
    confidence: z.number().min(0).max(1).optional(),
    extractedBy: z.string().regex(EXTRACTED_BY, "extractedBy must be pipeline | human | llm/<model>"),
    source: factSource.optional(),
    measuredAt: z.coerce.string().optional(),
    validWithinDays: z.number().int().positive().optional(),
    reviewedBy: z.string().min(1).nullable().optional(),
    reviewedAt: z.coerce.string().nullable().optional(),
  })
  // An LLM-extracted fact with no quote is exactly the thing the grounding gate
  // exists to kill; reject it at the file level too, so a hand-edited facts.yaml
  // can't smuggle one in behind the gate.
  .refine((f) => !f.extractedBy.startsWith("llm/") || f.source !== undefined, {
    message: "llm-extracted facts need a source { doc, quote }",
    path: ["source"],
  })
  .refine((f) => !f.extractedBy.startsWith("llm/") || f.confidence !== undefined, {
    message: "llm-extracted facts need a confidence",
    path: ["confidence"],
  })
  .refine((f) => f.extractedBy !== "pipeline" || f.confidence === undefined, {
    message: "pipeline facts are deterministic and carry no confidence",
    path: ["confidence"],
  })
  // A human decision is the whole audit trail, so it is required on both
  // outcomes and forbidden before one — except for pipeline facts, which no
  // human ever touched.
  .refine(
    (f) =>
      f.status === "proposed" ||
      f.extractedBy === "pipeline" ||
      (typeof f.reviewedBy === "string" && f.reviewedBy.length > 0),
    { message: "confirmed/rejected facts need a reviewedBy", path: ["reviewedBy"] },
  )
  .refine(
    (f) =>
      f.status === "proposed" ||
      f.extractedBy === "pipeline" ||
      (typeof f.reviewedAt === "string" && f.reviewedAt.length > 0),
    { message: "confirmed/rejected facts need a reviewedAt timestamp", path: ["reviewedAt"] },
  )
  .refine((f) => f.status !== "proposed" || f.reviewedBy == null, {
    message: "a proposed fact cannot claim a reviewedBy",
    path: ["reviewedBy"],
  });

const factsFile = z
  .strictObject({
    patient: z.string().min(1),
    asOf: z.coerce.string().optional(),
    facts: z.array(factEntry),
  })
  // Two live entries for one fact name is an unresolvable conflict for the
  // evaluator, so it is a parse error. Rejected entries are history, not data,
  // and may repeat freely.
  .refine(
    (f) => {
      const live = f.facts.filter((e) => e.status !== "rejected").map((e) => e.fact);
      return new Set(live).size === live.length;
    },
    { message: "duplicate live entries for the same fact name", path: ["facts"] },
  );

function describeIssues(issues: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []): string[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      return issue.errors.flatMap((branch) => describeIssues(branch, path));
    }
    return [`${path.join(".")}: ${issue.message}`];
  });
}

function parseWith<T>(schema: z.ZodType<T>, yamlText: string, what: string): T {
  const raw: unknown = parseYaml(yamlText);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = [...new Set(describeIssues(result.error.issues))].join("; ");
    throw new Error(`invalid ${what}: ${issues}`);
  }
  return result.data;
}

export const parseFactsFile = (t: string): FactsFile => parseWith(factsFile, t, "facts file");

export const isLlmExtracted = (e: FactEntry): boolean => e.extractedBy.startsWith("llm/");
