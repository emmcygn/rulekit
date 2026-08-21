import { useEffect, useRef, useState } from "react";
import type { Finding } from "./api.js";
import { realEngine } from "./real.js";
import type { CheckRequest, CheckResponse } from "./check.worker.js";

/**
 * Debounced static analysis. Runs in a worker; if the environment refuses to
 * start one, it falls back to the main thread rather than losing diagnostics.
 */
export function useCheck(rulesetYaml: string, factModelYaml: string, delayMs = 250): Finding[] {
  const [findings, setFindings] = useState<Finding[]>(() =>
    realEngine.check(rulesetYaml, factModelYaml),
  );
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./check.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<CheckResponse>) => {
        // Ignore stale answers: only the newest request may paint.
        if (event.data.seq === seqRef.current) setFindings(event.data.findings);
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
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      const worker = workerRef.current;
      if (worker) {
        worker.postMessage({ seq, rulesetYaml, factModelYaml } satisfies CheckRequest);
      } else {
        setFindings(realEngine.check(rulesetYaml, factModelYaml));
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [rulesetYaml, factModelYaml, delayMs]);

  return findings;
}
