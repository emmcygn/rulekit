import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file (scripts/lib/paths.ts) so cwd never matters. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The one reference date the whole pipeline ages against. Never `Date.now()` —
 * a corpus that changes when you rebuild it on a different day is not a fixture.
 */
export const REFERENCE_DATE = "2026-06-30";
