#!/usr/bin/env tsx
/**
 * Stage 0 of the data pipeline: get raw source data.
 *
 * Downloads the pre-generated Synthea FHIR R4 sample bundles (Apache-2.0,
 * ~85 MB zipped) and unzips them into `data/synthea/`, which is git-ignored.
 * No Java, no Synthea run — the published sample set is enough for a corpus.
 *
 * Idempotent: if `data/synthea/fhir` already holds bundles, it does nothing.
 * `--force` re-downloads. `--keep-zip` leaves the archive on disk.
 *
 *   npx tsx scripts/fetch-synthea.ts [--force] [--keep-zip]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findBundleDir } from "./lib/bundles.js";
import { REPO_ROOT } from "./lib/paths.js";

export const SYNTHEA_URL =
  "https://synthetichealth.github.io/synthea-sample-data/downloads/synthea_sample_data_fhir_r4_sep2019.zip";

const DATA_DIR = join(REPO_ROOT, "data", "synthea");
const ZIP_PATH = join(DATA_DIR, "synthea_sample_data_fhir_r4_sep2019.zip");

function unzip(zip: string, dest: string): void {
  // `unzip` on every mainstream image; bsdtar (macOS/BSD `tar`) reads zip too.
  for (const [cmd, args] of [
    ["unzip", ["-q", "-o", zip, "-d", dest]],
    ["tar", ["-x", "-f", zip, "-C", dest]],
  ] as const) {
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.status === 0) return;
  }
  throw new Error(`could not unzip ${zip}: neither \`unzip\` nor \`tar\` succeeded`);
}

async function download(url: string, dest: string): Promise<void> {
  process.stderr.write(`downloading ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  process.stderr.write(`  wrote ${(buf.length / 1e6).toFixed(1)} MB to ${dest}\n`);
}

async function main(argv: string[]): Promise<void> {
  const force = argv.includes("--force");
  const keepZip = argv.includes("--keep-zip");

  if (!force) {
    const existing = findBundleDir(DATA_DIR);
    if (existing) {
      const n = readdirSync(existing).filter((f) => f.endsWith(".json")).length;
      process.stderr.write(`synthea bundles already present: ${n} files in ${existing} (use --force to refetch)\n`);
      return;
    }
  }

  mkdirSync(DATA_DIR, { recursive: true });
  if (force || !existsSync(ZIP_PATH)) await download(SYNTHEA_URL, ZIP_PATH);
  unzip(ZIP_PATH, DATA_DIR);
  if (!keepZip) rmSync(ZIP_PATH, { force: true });

  const dir = findBundleDir(DATA_DIR);
  if (!dir) throw new Error(`unzip produced no bundles under ${DATA_DIR}`);
  const n = readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  process.stderr.write(`ready: ${n} FHIR bundles in ${dir}\n`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
