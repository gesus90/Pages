import { useEffect } from "react";
import { useFetcher } from "react-router";

import type { AgentPlanRunSummary } from "@/definition/AgentPlan";

interface RunSummariesResponse {
  readonly ok: boolean;
  readonly planId?: string;
  readonly runs?: readonly AgentPlanRunSummary[];
}

/**
 * Reads the run history of the plan as start and status only, while it is wanted.
 *
 * @remarks
 * The history is read each time it becomes wanted, such as when the console
 * opens; the editor itself needs only the newest run.
 *
 * @returns The runs newest first, or `null` before they arrived.
 */
export function usePlanRunSummaries(
  planId: string | undefined,
  isWanted: boolean,
): readonly AgentPlanRunSummary[] | null {
  const fetcher = useFetcher<RunSummariesResponse>();
  const { load } = fetcher;
  const response = fetcher.data;
  useEffect(() => {
    if (!isWanted || !planId) return;
    void load(
      `/agent-api/plan-run-summaries?${new URLSearchParams({ planId }).toString()}`,
    );
  }, [isWanted, planId, load]);
  return response?.ok && response.planId === planId
    ? (response.runs ?? null)
    : null;
}
