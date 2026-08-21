/// <reference lib="webworker" />
/**
 * Static analysis off the UI thread: the author keeps typing while `check`
 * re-runs (design spec §6, "the same passes run in a web worker feeding Monaco
 * diagnostics").
 */
import { realEngine } from "./real.js";
import type { Finding } from "./api.js";

export type CheckRequest = { seq: number; rulesetYaml: string; factModelYaml: string };
export type CheckResponse = { seq: number; findings: Finding[] };

self.addEventListener("message", (event: MessageEvent<CheckRequest>) => {
  const { seq, rulesetYaml, factModelYaml } = event.data;
  const findings = realEngine.check(rulesetYaml, factModelYaml);
  (self as unknown as Worker).postMessage({ seq, findings } satisfies CheckResponse);
});
