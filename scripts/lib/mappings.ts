/**
 * Loads the committed mapping tables in scripts/mappings/. Both tables are
 * files rather than API calls on purpose — see the header of
 * scripts/mappings/local-to-loinc.yaml.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./paths.js";

export type LocalCode = { local: string; loinc: string; slug: string };
export type UnitConversion = { slug: string; from: string; to: string; factor: number };
export type UnitTable = { aliases: Record<string, string>; conversions: UnitConversion[] };

const MAPPINGS_DIR = join(REPO_ROOT, "scripts", "mappings");
const read = (file: string): unknown => parse(readFileSync(join(MAPPINGS_DIR, file), "utf8"));

let localCodes: LocalCode[] | undefined;
export function loadLocalCodes(): LocalCode[] {
  if (!localCodes) {
    const raw = read("local-to-loinc.yaml") as { codes: LocalCode[] };
    localCodes = raw.codes;
  }
  return localCodes;
}

let units: UnitTable | undefined;
export function loadUnits(): UnitTable {
  if (!units) {
    const raw = read("units.yaml") as UnitTable;
    units = { aliases: raw.aliases ?? {}, conversions: raw.conversions ?? [] };
  }
  return units;
}

/** A local code the mapping table deliberately does not resolve. */
export const UNRESOLVABLE_LOCAL_CODE = "XLAB-77";

/** Fact-name fragment for a code: `CREAT-S` -> `creat_s`. */
export const slugifyCode = (code: string): string =>
  code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
