import { useEffect, useState } from "react";

import { backendRequestHeaders } from "@/app/lib/backend-request";

import type { AutomationRunDetail } from "@/definition/Automation";

/** A run the dialog opens: the automation and the run. */
export interface RunReference {
  readonly automationId: string;
  readonly runId: string;
}

/** What the run dialog knows about the opened run. */
export interface AutomationRunState {
  readonly detail: AutomationRunDetail | null;
  readonly isLoading: boolean;
  readonly hasFailed: boolean;
}

function isRunDetail(value: unknown): value is AutomationRunDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    "deliveries" in value &&
    Array.isArray(value.deliveries)
  );
}

/**
 * Reads one run with its answer, output, error, trigger data and
 * deliveries while the dialog shows it (PAGE-297).
 */
export function useAutomationRun(
  reference: RunReference | null,
): AutomationRunState {
  const [state, setState] = useState<AutomationRunState>({
    detail: null,
    isLoading: reference !== null,
    hasFailed: false,
  });
  const automationId = reference?.automationId ?? null;
  const runId = reference?.runId ?? null;
  useEffect(() => {
    if (automationId === null || runId === null) {
      setState({ detail: null, isLoading: false, hasFailed: false });
      return undefined;
    }
    const controller = new AbortController();
    setState({ detail: null, isLoading: true, hasFailed: false });
    const url = `/automationen-api/runs/${encodeURIComponent(automationId)}/${encodeURIComponent(runId)}`;
    void fetch(url, {
      cache: "no-store",
      headers: backendRequestHeaders({ Accept: "application/json" }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = response.ok ? await response.json() : null;
        setState({
          detail: isRunDetail(payload) ? payload : null,
          isLoading: false,
          hasFailed: !isRunDetail(payload),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] The automation run could not be read.", error);
        setState({ detail: null, isLoading: false, hasFailed: true });
      });
    return () => controller.abort();
  }, [automationId, runId]);
  return state;
}
