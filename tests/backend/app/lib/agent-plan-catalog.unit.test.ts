import { expect, it } from "vitest";

import {
  planCatalogRefresh,
  planCatalogResponse,
} from "@/app/lib/agent-plan-catalog.server";
import { planPollingEtag } from "@/app/lib/agent-plan-poll-response.server";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

const PLAN: AgentPlanView = {
  id: "plan-1",
  ownerId: "owner",
  projectId: "project",
  revision: 2,
  name: "Plan",
  workspaceId: "workspace-1",
  usage: "private",
  globals: {},
  nodes: [],
  edges: [],
  canEdit: true,
  projectName: "Project",
  github: null,
};

const WORKSPACE: AgentWorkspaceChoice = {
  id: "workspace-1",
  name: "Workspace",
  path: "/srv/workspace",
  projectId: "project",
  projectName: "Project",
  github: null,
  isUsable: true,
  reason: null,
};

function pageOf(selected: AgentPlanView | null): AgentPlanPage {
  return {
    userId: "owner",
    teamDepartmentId: null,
    plans: selected ? [selected] : [],
    workspaces: [WORKSPACE],
    selected,
    sources: { agents: [], tasks: [] },
    runs: [],
    directory: { persons: [], groups: [], departments: [] },
  };
}

it("refreshes the selected plan and ignores a workspace hint", () => {
  const refresh = planCatalogRefresh(pageOf(PLAN), "workspace-1");

  expect(refresh.url).toBe("/agent-api/plan-sources?refresh=1&planId=plan-1");
});

it("keeps a known workspace when no plan is selected", () => {
  const refresh = planCatalogRefresh(pageOf(null), "workspace-1");

  expect(refresh.url).toBe(
    "/agent-api/plan-sources?refresh=1&workspaceId=workspace-1",
  );
});

it("drops an unknown or missing workspace from the refresh address", () => {
  expect(planCatalogRefresh(pageOf(null), "foreign").url).toBe(
    "/agent-api/plan-sources?refresh=1",
  );
  expect(planCatalogRefresh(pageOf(null), null).url).toBe(
    "/agent-api/plan-sources?refresh=1",
  );
});

it("derives the change marker from the authorized context but not from runs", () => {
  const page = pageOf(PLAN);
  const refresh = planCatalogRefresh(page, null);
  const withRuns = planCatalogRefresh({ ...page, runs: [] }, null);

  expect(refresh.etag).toBe(
    planPollingEtag({
      userId: "owner",
      teamDepartmentId: null,
      plans: [PLAN],
      workspaces: [WORKSPACE],
      remoteWorkspaces: undefined,
      selected: PLAN,
      sources: page.sources,
      directory: page.directory,
    }),
  );
  expect(withRuns.etag).toBe(refresh.etag);
  expect(planCatalogRefresh(pageOf(null), null).etag).not.toBe(refresh.etag);
});

it("answers an unchanged catalog with an empty uncacheable 304", async () => {
  const response = planCatalogResponse(
    new Request("http://pages.invalid/", {
      headers: { "If-None-Match": 'W/"same"' },
    }),
    'W/"same"',
  );

  expect(response.status).toBe(304);
  expect(response.headers.get("ETag")).toBe('W/"same"');
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toBe("");
});

it("answers a changed catalog with only a change marker", async () => {
  const response = planCatalogResponse(
    new Request("http://pages.invalid/", {
      headers: { "If-None-Match": 'W/"old"' },
    }),
    'W/"new"',
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("ETag")).toBe('W/"new"');
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ changed: true });
});
