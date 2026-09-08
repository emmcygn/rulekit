#!/usr/bin/env tsx
/** Run the fixed recorded-response eval with promptfoo's supported opt-outs. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { REPO_ROOT } from "./lib/paths.js";

if (process.argv.length > 2) {
  process.stderr.write("The recorded eval takes no arguments. See evals/README.md for the separate live workflow.\n");
  process.exit(2);
}

const packageDir = join(REPO_ROOT, "node_modules", "promptfoo");
const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
  bin: { promptfoo: string };
};
const cli = resolve(packageDir, manifest.bin.promptfoo);
if (!cli.startsWith(`${packageDir}${sep}`)) throw new Error("promptfoo CLI must resolve inside its installed package");

const result = spawnSync(process.execPath, [cli, "eval", "-c", "evals/promptfooconfig.yaml"], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    // Supported by promptfoo's telemetry and update modules. Override inherited
    // values so the npm script has the same behavior locally and in CI.
    PROMPTFOO_DISABLE_TELEMETRY: "1",
    PROMPTFOO_DISABLE_UPDATE: "1",
  },
});
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
