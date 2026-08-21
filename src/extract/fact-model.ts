/**
 * Where the extraction pipeline gets its vocabulary.
 *
 * The repo has exactly one `patient-facts/v1` — packs/trials/fact-model.yaml —
 * and everything that grounds, reviews or evaluates a proposed fact resolves it
 * through here rather than joining its own path. corpus/fact-model.yaml used to
 * be a second, contradictory copy of the same name; this constant is what keeps
 * a third from appearing.
 *
 * The names the pipeline is allowed to emit are therefore exactly the keys of
 * this file: the bare clinical vocabulary (nyha_class, lvef, egfr, nt_probnp,
 * on_*, ...). The `lab_*` family in the same model belongs to the structured
 * flatten path (scripts/flatten-synthea.ts), not to note extraction.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFactModel, type FactModel } from "../core/schema.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo-root-relative `packs/trials/fact-model.yaml`, resolved from this module. */
export const FACT_MODEL_PATH = join(here, "..", "..", "packs", "trials", "fact-model.yaml");

export const readFactModelYaml = (path: string = FACT_MODEL_PATH): string => readFileSync(path, "utf8");

export const loadFactModel = (path: string = FACT_MODEL_PATH): FactModel =>
  parseFactModel(readFactModelYaml(path));
