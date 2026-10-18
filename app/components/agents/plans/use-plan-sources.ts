import { useEffect } from "react";
import { useFetcher } from "react-router";

import type { AgentPlanPage, AgentPlanSources } from "@/definition/AgentPlan";

interface PlanSourceResponse {
  readonly workspaceId?: string;
  readonly sources?: AgentPlanSources;
  readonly error?: string;
}

/** Context changes cannot expose the previous workspace's agents or tickets as current choices. */
export function usePlanSources(
  page: AgentPlanPage,
  workspaceId: string,
): {
  readonly sources: AgentPlanSources;
  readonly isPending: boolean;
  readonly error: string | null;
} {
  const request = useFetcher<PlanSourceResponse>();
  const { load } = request;
  const isInitial = workspaceId === (page.selected?.workspaceId ?? "");
  useEffect(() => {
    if (workspaceId && !isInitial)
      void load(
        `/agent-api/plan-sources?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
  }, [workspaceId, isInitial, load]);
  if (isInitial)
    return { sources: page.sources, isPending: false, error: null };
  return {
    sources:
      request.data?.workspaceId === workspaceId && request.data.sources
        ? request.data.sources
        : { agents: [], tasks: [] },
    isPending: request.state !== "idle",
    error: request.state === "idle" ? (request.data?.error ?? null) : null,
  };
}
