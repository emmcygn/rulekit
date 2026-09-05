import { useEffect, useMemo, useRef, useState } from "react";
import type { PatientFacts, RuleSet } from "../../../src/core/schema.js";
import type { Engine } from "../engine/api.js";
import type { DisplayBandCounts } from "../funnel/bands.js";
import {
  numericTargetsFromRuleSet,
  prepareSensitivity,
  sensitivityCounts,
  yieldsAreRanked,
  yieldsFromPrepared,
  type PreparedSensitivity,
  type Target,
  type Yield,
} from "./compute.js";
import type { SensitivityRequest, SensitivityResponse } from "./sensitivity.worker.js";

type Analysis = {
  generation: number;
  ranked: Yield[];
  before: DisplayBandCounts;
};

export type SensitivityState = {
  targets: Target[];
  target?: Target;
  ranked: Yield[];
  before?: DisplayBandCounts;
  after?: DisplayBandCounts;
  pending: boolean;
  error?: string;
};

const samePath = (a: readonly (string | number)[], b: readonly (string | number)[]): boolean =>
  a.length === b.length && a.every((part, index) => part === b[index]);

/** Cohort-wide sensitivity runs in a worker, with a debounced main-thread fallback. */
export function useSensitivity(
  rulesetYaml: string,
  ruleset: RuleSet,
  cohort: PatientFacts[],
  engine: Engine,
  pickedId: string | null,
  preview: number | null,
  delayMs = 75,
): SensitivityState {
  const targets = useMemo(() => numericTargetsFromRuleSet(ruleset), [ruleset]);
  const [analysis, setAnalysis] = useState<Analysis>();
  const [after, setAfter] = useState<{
    path: (string | number)[];
    value: number;
    counts: DisplayBandCounts;
  }>();
  const [error, setError] = useState<string>();
  const workerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);
  const preparedRef = useRef<{ generation: number; value: PreparedSensitivity } | undefined>(undefined);

  const ordered = analysis ? yieldsAreRanked(analysis.ranked) : false;
  const best = ordered ? analysis?.ranked[0]?.target : undefined;
  const target =
    targets.find((candidate) => `${candidate.criterionId}.${candidate.knob}` === pickedId) ??
    targets.find(
      (candidate) =>
        best && candidate.criterionId === best.criterionId && candidate.knob === best.knob,
    ) ??
    targets[0];
  const current = preview ?? target?.value;

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./sensitivity.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<SensitivityResponse>) => {
        const response = event.data;
        if (response.generation !== generationRef.current) return;
        if (response.kind === "analysis") {
          setAnalysis(response);
          setError(undefined);
        } else if (response.kind === "preview") {
          setAfter({ path: response.path, value: response.value, counts: response.after });
        } else {
          setError(response.message);
        }
      });
    } catch {
      worker = null;
    }
    workerRef.current = worker;
    return () => {
      worker?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    setAnalysis(undefined);
    setAfter(undefined);
    setError(undefined);
    preparedRef.current = undefined;
    const timer = setTimeout(() => {
      const worker = workerRef.current;
      if (worker !== null) {
        worker.postMessage({
          kind: "analyze",
          generation,
          rulesetYaml,
          ruleset,
          cohort,
        } satisfies SensitivityRequest);
        return;
      }
      try {
        const evaluations = cohort.map((patient) => engine.evalPatient(rulesetYaml, patient));
        const prepared = prepareSensitivity(ruleset, cohort, evaluations);
        preparedRef.current = { generation, value: prepared };
        setAnalysis({
          generation,
          ranked: yieldsFromPrepared(prepared),
          before: prepared.before,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [rulesetYaml, ruleset, cohort, engine, delayMs]);

  useEffect(() => {
    if (analysis === undefined || target === undefined || current === undefined) return;
    if (current === target.value) {
      setAfter({ path: target.path, value: current, counts: analysis.before });
      return;
    }
    setAfter(undefined);
    const generation = analysis.generation;
    const timer = setTimeout(() => {
      const worker = workerRef.current;
      if (worker !== null) {
        worker.postMessage({
          kind: "preview",
          generation,
          path: target.path,
          value: current,
        } satisfies SensitivityRequest);
        return;
      }
      const prepared = preparedRef.current;
      if (prepared?.generation !== generation) return;
      try {
        setAfter({
          path: target.path,
          value: current,
          counts: sensitivityCounts(prepared.value, target, current),
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [analysis, target, current, delayMs]);

  // A preview response for a previous target/value is harmless numerically but
  // must not paint under the newly selected knob.
  const currentAfter =
    after !== undefined && target !== undefined && current === after.value && samePath(target.path, after.path)
      ? after.counts
      : undefined;

  return {
    targets,
    target,
    ranked: analysis?.ranked ?? [],
    before: analysis?.before,
    after: currentAfter,
    pending: analysis === undefined || currentAfter === undefined,
    ...(error === undefined ? {} : { error }),
  };
}
