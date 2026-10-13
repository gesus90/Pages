import { useEffect } from "react";
import { useFetcher } from "react-router";

import type { AgentPlanPage, AgentPlanSources } from "@/definition/AgentPlan";

type PlanSourceResponse =
  | { readonly workspaceId: string; readonly sources: AgentPlanSources }
  | { readonly ok: false; readonly error: string };

/** Delayed picker responses cannot cross project or workspace selections. */
export function usePlanSources(
  page: AgentPlanPage,
  workspaceId: string,
): { readonly sources: AgentPlanSources; readonly sourceError: string | null } {
  const request = useFetcher<PlanSourceResponse>();
  const { load } = request;
  const response = request.data;
  let sources = page.sources;
  if (workspaceId !== page.selected?.workspaceId)
    sources = { agents: [], tasks: [] };
  if (response && "sources" in response && response.workspaceId === workspaceId)
    sources = response.sources;
  useEffect(() => {
    if (workspaceId && workspaceId !== page.selected?.workspaceId)
      void load(
        `/agent-api/plan-sources?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
  }, [workspaceId, page.selected?.workspaceId, load]);
  return {
    sources,
    sourceError: response && "error" in response ? response.error : null,
  };
}
