import { useEffect } from "react";
import { useFetcher } from "react-router";

import { usePlanTicketRefresh } from "./use-plan-ticket-refresh";

import type { AgentPlanPage, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanTicketRefresh } from "./use-plan-ticket-refresh";

const EMPTY_SOURCES: AgentPlanSources = { agents: [], tasks: [] };

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
  readonly tickets: PlanTicketRefresh;
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
  let basis: AgentPlanSources = page.sources;
  if (!isInitial)
    basis =
      request.data?.workspaceId === workspaceId && request.data.sources
        ? request.data.sources
        : EMPTY_SOURCES;
  const { sources, tickets } = usePlanTicketRefresh(workspaceId, basis);
  if (isInitial) return { sources, isPending: false, error: null, tickets };
  return {
    sources,
    isPending: request.state !== "idle",
    error: request.state === "idle" ? (request.data?.error ?? null) : null,
    tickets,
  };
}
