import { vi } from "vitest";

import type { usePlanManagement } from "@/app/components/agents/plans/plan-management/use-plan-management";
import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanRemoteChoice } from "@/definition/AgentPlanTarget";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** A local workspace of a project; `overrides` change single fields. */
export function localWorkspace(
  id: string,
  projectId: string,
  overrides: Partial<AgentWorkspaceChoice> = {},
): AgentWorkspaceChoice {
  return {
    id,
    name: `Workspace ${id}`,
    path: `/synthetic/${id}`,
    projectId,
    projectName: `Project ${projectId}`,
    github: null,
    isUsable: true,
    reason: null,
    ...overrides,
  };
}

/** A remote workspace of a project on the host `Runner`; `overrides` change single fields. */
export function remoteWorkspace(
  workspaceId: string,
  projectId: string,
  overrides: Partial<AgentPlanRemoteChoice> = {},
): AgentPlanRemoteChoice {
  return {
    workspaceId,
    workspaceName: `Remote ${workspaceId}`,
    connectionName: "Runner",
    projectId,
    path: `/remote/${workspaceId}`,
    isUsable: true,
    reason: null,
    ...overrides,
  };
}

/** A saved plan of the project `alpha` in the workspace `one`, owned by `owner`. */
export function planView(
  overrides: Partial<AgentPlanView> = {},
): AgentPlanView {
  return {
    id: "plan",
    name: "Review plan",
    workspaceId: "one",
    usage: "private",
    globals: {},
    nodes: [],
    edges: [],
    ownerId: "owner",
    projectId: "alpha",
    revision: 4,
    departmentId: "team",
    canEdit: true,
    projectName: "Project alpha",
    github: null,
    ...overrides,
  };
}

/**
 * A plan page with the projects `alpha` and `beta`: `alpha` has the local
 * workspaces `one` and `two`, a usable remote workspace `far` and an unusable
 * one `blocked`; `beta` has the local workspace `three`.
 */
export function managementPage(
  overrides: Partial<AgentPlanPage> = {},
): AgentPlanPage {
  return {
    userId: "owner",
    teamDepartmentId: "team",
    plans: [planView()],
    workspaces: [
      localWorkspace("one", "alpha"),
      localWorkspace("two", "alpha"),
      localWorkspace("three", "beta"),
    ],
    remoteWorkspaces: [
      remoteWorkspace("far", "alpha"),
      remoteWorkspace("blocked", "alpha", {
        isUsable: false,
        reason: "console_denied",
      }),
    ],
    selected: null,
    sources: { agents: [], tasks: [] },
    runs: [],
    directory: { persons: [], groups: [], departments: [] },
    ...overrides,
  };
}

/** The plan menu state with an open dialog whose actions are spies. */
export function managementState(
  overrides: Partial<ReturnType<typeof usePlanManagement>> = {},
): ReturnType<typeof usePlanManagement> {
  return {
    dialog: null,
    open: vi.fn(),
    close: vi.fn(),
    submit: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  };
}
