import { useEffect, useRef, useState } from "react";
import type { Finding } from "./api.js";
import { realEngine } from "./real.js";
import type { CheckRequest, CheckResponse } from "./check.worker.js";

/**
 * Debounced static analysis. Runs in a worker; if the environment refuses to
 * start one, it falls back to the main thread rather than losing diagnostics.
 */
export type CheckState = {
  findings: Finding[];
  rulesetYaml: string;
  factModelYaml: string;
};

export function useCheck(rulesetYaml: string, factModelYaml: string, delayMs = 250): CheckState {
  const [state, setState] = useState<CheckState>(() => ({
    findings: realEngine.check(rulesetYaml, factModelYaml),
    rulesetYaml,
    factModelYaml,
  }));
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const initialRef = useRef(true);
  const requestRef = useRef(new Map<number, { rulesetYaml: string; factModelYaml: string }>());

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./check.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<CheckResponse>) => {
        // Ignore stale answers: only the newest request may paint.
        const source = requestRef.current.get(event.data.seq);
        requestRef.current.delete(event.data.seq);
        if (event.data.seq === seqRef.current && source !== undefined) {
          setState({ findings: event.data.findings, ...source });
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
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }
    const seq = ++seqRef.current;
    requestRef.current.set(seq, { rulesetYaml, factModelYaml });
    const timer = setTimeout(() => {
      const worker = workerRef.current;
      if (worker) {
        worker.postMessage({ seq, rulesetYaml, factModelYaml } satisfies CheckRequest);
      } else {
        setState({
          findings: realEngine.check(rulesetYaml, factModelYaml),
          rulesetYaml,
          factModelYaml,
        });
        requestRef.current.delete(seq);
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      requestRef.current.delete(seq);
    };
  }, [rulesetYaml, factModelYaml, delayMs]);

  return state;
}
