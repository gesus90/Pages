import { planPollingEtag } from "./agent-plan-poll-response.server";
import { AGENT_NO_STORE } from "./settings-actions/settings-agents-response.server";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { PlanCatalogRefresh } from "@/app/components/agents/plans/use-plan-catalog-refresh";

/** Identifies catalog, access and editor context; run/control progress has its own two-second channel. */
export function planCatalogRefresh(
  page: AgentPlanPage,
  workspaceId: string | null,
): PlanCatalogRefresh {
  const query = new URLSearchParams({ refresh: "1" });
  if (page.selected) query.set("planId", page.selected.id);
  else if (
    workspaceId &&
    page.workspaces.some((workspace) => workspace.id === workspaceId)
  )
    query.set("workspaceId", workspaceId);
  return {
    url: `/agent-api/plan-sources?${query}`,
    etag: planPollingEtag({
      userId: page.userId,
      teamDepartmentId: page.teamDepartmentId,
      plans: page.plans,
      workspaces: page.workspaces,
      remoteWorkspaces: page.remoteWorkspaces,
      selected: page.selected,
      sources: page.sources,
      directory: page.directory,
    }),
  };
}

/** Returns only a change marker after a complete authorized context read, never another full page per tick. */
export function planCatalogResponse(request: Request, etag: string): Response {
  const headers = { ...AGENT_NO_STORE, ETag: etag };
  return request.headers.get("If-None-Match") === etag
    ? new Response(null, { status: 304, headers })
    : Response.json({ changed: true }, { headers });
}
