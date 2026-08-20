import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Directory holding the unzipped Synthea bundles, or undefined if none is
 * present. Lives here rather than in fetch-synthea.ts so importing it never
 * triggers a download.
 */
export function findBundleDir(root: string): string | undefined {
  for (const dir of [join(root, "fhir"), root]) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    if (readdirSync(dir).some((f) => f.endsWith(".json"))) return dir;
  }
  return undefined;
}
