/// <reference lib="webworker" />
import type { PatientFacts, RuleSet } from "../../../src/core/schema.js";
import { resolveChartReview } from "../engine/chart-review.js";
import { realEngine } from "../engine/real.js";
import {
  prepareSensitivity,
  sensitivityCounts,
  yieldsFromPrepared,
  type PreparedSensitivity,
  type Target,
  type Yield,
} from "./compute.js";
import type { DisplayBandCounts } from "../funnel/bands.js";

export type AnalyzeRequest = {
  kind: "analyze";
  generation: number;
  rulesetYaml: string;
  ruleset: RuleSet;
  cohort: PatientFacts[];
};

export type PreviewRequest = {
  kind: "preview";
  generation: number;
  path: (string | number)[];
  value: number;
};

export type SensitivityRequest = AnalyzeRequest | PreviewRequest;
export type SensitivityResponse =
  | {
      kind: "analysis";
      generation: number;
      ranked: Yield[];
      before: DisplayBandCounts;
    }
  | { kind: "preview"; generation: number; path: (string | number)[]; value: number; after: DisplayBandCounts }
  | { kind: "error"; generation: number; message: string };

let cache: { generation: number; prepared: PreparedSensitivity } | undefined;
const samePath = (a: readonly (string | number)[], b: readonly (string | number)[]): boolean =>
  a.length === b.length && a.every((part, index) => part === b[index]);

self.addEventListener("message", (event: MessageEvent<SensitivityRequest>) => {
  const request = event.data;
  try {
    if (request.kind === "analyze") {
      const evaluations = request.cohort.map((patient) =>
        resolveChartReview(realEngine.evalPatient(request.rulesetYaml, patient), patient),
      );
      const prepared = prepareSensitivity(request.ruleset, request.cohort, evaluations);
      cache = { generation: request.generation, prepared };
      (self as unknown as Worker).postMessage({
        kind: "analysis",
        generation: request.generation,
        ranked: yieldsFromPrepared(prepared),
        before: prepared.before,
      } satisfies SensitivityResponse);
      return;
    }

    if (cache?.generation !== request.generation) return;
    const target: Target | undefined = cache.prepared.targets.find((candidate) =>
      samePath(candidate.path, request.path),
    );
    if (target === undefined) throw new Error("sensitivity target is no longer present");
    (self as unknown as Worker).postMessage({
      kind: "preview",
      generation: request.generation,
      path: request.path,
      value: request.value,
      after: sensitivityCounts(cache.prepared, target, request.value),
    } satisfies SensitivityResponse);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      kind: "error",
      generation: request.generation,
      message: error instanceof Error ? error.message : String(error),
    } satisfies SensitivityResponse);
  }
});
